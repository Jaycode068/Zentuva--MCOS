import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Product } from '@prisma/client';

import { ProductRepository } from '../../catalogue/product/product.repository';
import { OrganisationService } from '../../identity/organisation/organisation.service';
import { SalesOrderService } from '../../sales/sales-order.service';
import { SalesOrderWithRelations } from '../../sales/sales-order.repository';
import { ConsumerService } from '../consumer/consumer.service';
import {
  CartLine,
  CartSummaryResult,
  D2COrderResult,
  D2CProductOption,
} from './d2c-ordering.types';

/** Thrown when a consumer's cart line no longer resolves to an orderable product —
 *  caught by `ConversationService` specifically (brief §15), never the generic
 *  catch-all. */
export class CartItemUnavailableError extends Error {
  constructor(public readonly productId: string) {
    super('One or more items in your cart are no longer available');
  }
}

/**
 * Sprint 34 — the D2C Ordering Application Service (docs/domains/d2c.md "D2C Ordering
 * Architecture"). Sits between the Conversation Layer (Sprint 33) and the existing Sales
 * Order domain (Sprint 4.8), per the brief's own responsibility split: validates the
 * Consumer, validates/prices selected SKUs, builds the order request, and invokes
 * `SalesOrderService` — it never creates a `SalesOrder`/`SalesOrderItem` row itself, and
 * it never re-implements pricing/totals/idempotency, all of which live in
 * `SalesOrderService.createForConsumer`.
 *
 * Deliberately has NO Prisma dependency of its own and no cart persistence — a "cart" is
 * just a `CartLine[]` the Conversation Layer already owns in its own `context.cart`
 * (brief §4); every method here is a stateless, tenant-scoped read/validate/transform
 * over whatever cart array the caller currently holds.
 */
@Injectable()
export class D2COrderingService {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly consumerService: ConsumerService,
    private readonly organisationService: OrganisationService,
    private readonly salesOrderService: SalesOrderService,
  ) {}

  /** A product is D2C-orderable iff it's the tenant's own, a real SKU (never a
   *  `ProductFamily`/`ProductVariant`), active, and priced — see `Product.sellingPrice`'s
   *  schema doc comment. The one gate every method below re-checks independently rather
   *  than trusting a previous check's result (the same "second line of defense"
   *  convention `ProductService.assertVariantExists`/`SalesOrderService.buildItems`
   *  already use). */
  private isOrderable(product: Product): boolean {
    return (
      product.type === 'FINISHED_PRODUCT' &&
      product.status === 'ACTIVE' &&
      product.sellingPrice != null
    );
  }

  private async getOrderableProduct(
    organisationId: string,
    productId: string,
  ): Promise<Product | null> {
    const product = await this.productRepository.findById(organisationId, productId);
    if (!product || !this.isOrderable(product)) {
      return null;
    }
    return product;
  }

  private async getCurrency(organisationId: string): Promise<string> {
    const organisation = await this.organisationService.getById(organisationId);
    return organisation?.currency ?? 'USD';
  }

  /** brief §3 — "Browse Products". Reuses `ProductRepository` unchanged; never a second
   *  catalogue. */
  async getAvailableProducts(organisationId: string): Promise<D2CProductOption[]> {
    const [products, currency] = await Promise.all([
      this.productRepository.findManyByOrganisationWithHierarchy(organisationId, {
        status: 'ACTIVE',
      }),
      this.getCurrency(organisationId),
    ]);
    return products
      .filter((product) => this.isOrderable(product))
      .map((product) => ({
        skuId: product.id,
        productName: product.name,
        variantName: product.productVariant?.name ?? null,
        displayName: product.displayName ?? null,
        // `isOrderable` already guarantees this is non-null.
        sellingPrice: product.sellingPrice!,
        currency,
        available: true as const,
      }));
  }

  /** brief §4 — adding an SKU to the cart. Validates tenant scope, active status, and
   *  pricing (never trusts the client's claimed SKU is real or still orderable);
   *  quantity must be a positive whole number. Merges into an existing line for the same
   *  product (adding "2 more" of something already in the cart increases its quantity,
   *  never creates a duplicate line) — never trusts or reads a price here at all. */
  async addItemToCart(
    organisationId: string,
    cart: CartLine[],
    productId: string,
    quantity: number,
  ): Promise<CartLine[]> {
    this.assertValidQuantity(quantity);
    const product = await this.getOrderableProduct(organisationId, productId);
    if (!product) {
      throw new BadRequestException(
        'That product is no longer available. Please choose another product.',
      );
    }

    const existingIndex = cart.findIndex((line) => line.productId === productId);
    if (existingIndex >= 0) {
      const updated = [...cart];
      const existing = updated[existingIndex]!;
      updated[existingIndex] = { productId, quantity: existing.quantity + quantity };
      return updated;
    }
    return [...cart, { productId, quantity }];
  }

  /** brief §4 — setting a line's quantity to an exact value (distinct from
   *  {@link addItemToCart}'s "add more" semantics). */
  async updateCartItem(
    organisationId: string,
    cart: CartLine[],
    productId: string,
    quantity: number,
  ): Promise<CartLine[]> {
    this.assertValidQuantity(quantity);
    const index = cart.findIndex((line) => line.productId === productId);
    if (index < 0) {
      throw new BadRequestException('That item is not in your cart.');
    }
    const product = await this.getOrderableProduct(organisationId, productId);
    if (!product) {
      throw new BadRequestException(
        'That product is no longer available. Please choose another product.',
      );
    }
    const updated = [...cart];
    updated[index] = { productId, quantity };
    return updated;
  }

  /** brief §4 — pure, no validation needed: removing a line can never fail. */
  removeCartItem(cart: CartLine[], productId: string): CartLine[] {
    return cart.filter((line) => line.productId !== productId);
  }

  /**
   * brief §4/§6 — the server-authoritative cart summary shown at "Order Summary": every
   * line's price is the LIVE `Product.sellingPrice`, read here, never anything cached
   * from when the item was added. If a line's product became unavailable in the
   * meantime (brief §15), it is silently dropped from the returned `cart` — the caller
   * (`ConversationService`) persists this trimmed cart and shows the consumer the
   * brief's exact "we've updated your order" wording via `removedProductIds`.
   */
  async getCartSummary(organisationId: string, cart: CartLine[]): Promise<CartSummaryResult> {
    const currency = await this.getCurrency(organisationId);
    const keptCart: CartLine[] = [];
    const removedProductIds: string[] = [];
    const lines: CartSummaryResult['summary']['lines'] = [];

    for (const line of cart) {
      const product = await this.getOrderableProduct(organisationId, line.productId);
      if (!product) {
        removedProductIds.push(line.productId);
        continue;
      }
      keptCart.push(line);
      const unitPrice = product.sellingPrice!;
      lines.push({
        productId: line.productId,
        productName: product.displayName ?? product.name,
        quantity: line.quantity,
        unitPrice,
        lineTotal: roundCurrency(line.quantity * unitPrice),
      });
    }

    const subtotal = roundCurrency(lines.reduce((sum, line) => sum + line.lineTotal, 0));
    return { summary: { lines, subtotal, currency }, cart: keptCart, removedProductIds };
  }

  /**
   * brief §6/§7/§8/§9 — the confirmation step. Validates the Consumer is real and
   * tenant-scoped, re-validates every cart line is still orderable (defense in depth —
   * `SalesOrderService.createForConsumer` re-validates and re-prices again, the final
   * authoritative layer), then delegates order creation entirely to the existing Sales
   * Order domain. Idempotent: `idempotencyKey` is minted once by the Conversation Layer
   * when the consumer reaches order review and replayed unchanged on every subsequent
   * confirmation attempt for that checkout (docs/domains/d2c.md "Idempotency").
   */
  async confirmOrder(
    organisationId: string,
    consumerId: string,
    cart: CartLine[],
    idempotencyKey: string,
  ): Promise<{ result: D2COrderResult; wasCreated: boolean }> {
    const consumer = await this.consumerService.getById(organisationId, consumerId);
    if (!consumer) {
      throw new NotFoundException('Consumer not found');
    }
    if (cart.length === 0) {
      throw new BadRequestException('Your cart is empty.');
    }
    for (const line of cart) {
      const product = await this.getOrderableProduct(organisationId, line.productId);
      if (!product) {
        throw new CartItemUnavailableError(line.productId);
      }
    }

    const { order, wasCreated } = await this.salesOrderService.createForConsumer(organisationId, {
      consumerId,
      items: cart.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      orderDate: new Date(),
      idempotencyKey,
    });
    return { result: await this.toOrderResult(organisationId, order), wasCreated };
  }

  /** brief §9/§12 — ownership-enforced order lookup: a Consumer may only ever see their
   *  own order, never another consumer's (even within the same tenant) — the backend
   *  check, never only the conversation's own state. Returns the same shape a "not
   *  found" and a "belongs to someone else" get, so neither leaks which one occurred. */
  async getConsumerOrder(
    organisationId: string,
    consumerId: string,
    orderId: string,
  ): Promise<D2COrderResult> {
    const order = await this.salesOrderService.getById(organisationId, orderId).catch(() => null);
    if (!order || order.consumerId !== consumerId) {
      throw new NotFoundException('Order not found');
    }
    return this.toOrderResult(organisationId, order);
  }

  private async toOrderResult(
    organisationId: string,
    order: SalesOrderWithRelations,
  ): Promise<D2COrderResult> {
    const currency = await this.getCurrency(organisationId);
    return {
      orderId: order.id,
      orderCode: order.orderCode,
      orderDate: order.orderDate,
      status: order.status,
      items: order.items.map((item) => ({
        productName: item.product.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
      subtotal: order.subtotal,
      total: order.total,
      currency,
    };
  }

  private assertValidQuantity(quantity: number): void {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new BadRequestException('Please enter a valid quantity.');
    }
  }
}

/** Same rounding convention as `SalesOrderService`'s own `roundCurrency`. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
