import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Consumer, Product } from '@prisma/client';

import { ProductRepository } from '../../catalogue/product/product.repository';
import { OrganisationService } from '../../identity/organisation/organisation.service';
import { SalesOrderService } from '../../sales/sales-order.service';
import { ConsumerService } from '../consumer/consumer.service';
import { CartItemUnavailableError, D2COrderingService } from './d2c-ordering.service';

/**
 * Sprint 34 — `D2COrderingService` unit tests, focused on the pieces
 * `conversation.service.spec.ts`'s end-to-end tests don't already exercise directly:
 * product browsing filters, tenant scoping at the service boundary itself, and
 * ownership-enforced order lookup.
 */
describe('D2COrderingService', () => {
  const ORG_A = 'org-a';
  const ORG_B = 'org-b';

  function makeProduct(overrides: Partial<Product>): Product {
    return {
      id: 'product-1',
      organisationId: ORG_A,
      code: 'PRD-000001',
      name: 'Plantain Chips',
      displayName: null,
      slug: 'plantain-chips',
      category: 'SNACKS',
      type: 'FINISHED_PRODUCT',
      shortDescription: null,
      longDescription: null,
      unit: 'Pack',
      imageUrl: null,
      imageKey: null,
      status: 'ACTIVE',
      sellingPrice: 500,
      createdById: null,
      updatedById: null,
      createdAt: new Date('2026-09-01'),
      updatedAt: new Date('2026-09-01'),
      productVariantId: null,
      ...overrides,
    } as Product;
  }

  function makeService(products: Product[], consumers: Consumer[] = []) {
    const productRepository = {
      findById: jest.fn((organisationId: string, id: string) =>
        Promise.resolve(
          products.find((p) => p.id === id && p.organisationId === organisationId) ?? null,
        ),
      ),
      findManyByOrganisationWithHierarchy: jest.fn(
        (organisationId: string, params?: { status?: string }) =>
          Promise.resolve(
            products
              .filter(
                (p) =>
                  p.organisationId === organisationId &&
                  (!params?.status || p.status === params.status),
              )
              .map((p) => ({ ...p, productVariant: null })),
          ),
      ),
    } as unknown as ProductRepository;

    const consumerService = {
      getById: jest.fn((organisationId: string, id: string) =>
        Promise.resolve(
          consumers.find((c) => c.id === id && c.organisationId === organisationId) ?? null,
        ),
      ),
    } as unknown as ConsumerService;

    const organisationService = {
      getById: jest.fn().mockResolvedValue({ id: ORG_A, currency: 'NGN' }),
    } as unknown as OrganisationService;

    const salesOrderService = {
      createForConsumer: jest.fn(),
      getById: jest.fn(),
    } as unknown as jest.Mocked<SalesOrderService>;

    const service = new D2COrderingService(
      productRepository,
      consumerService,
      organisationService,
      salesOrderService,
    );
    return { service, productRepository, consumerService, salesOrderService };
  }

  describe('getAvailableProducts', () => {
    it('excludes inactive products, unpriced products, non-finished-product SKUs, and other tenants’ products', async () => {
      const products = [
        makeProduct({ id: 'active-priced', status: 'ACTIVE', sellingPrice: 500 }),
        makeProduct({ id: 'draft', status: 'DRAFT', sellingPrice: 500 }),
        makeProduct({ id: 'unpriced', status: 'ACTIVE', sellingPrice: null }),
        makeProduct({
          id: 'raw-material',
          status: 'ACTIVE',
          sellingPrice: 500,
          type: 'RAW_MATERIAL',
        }),
        makeProduct({
          id: 'other-tenant',
          organisationId: ORG_B,
          status: 'ACTIVE',
          sellingPrice: 500,
        }),
      ];
      const { service } = makeService(products);

      const result = await service.getAvailableProducts(ORG_A);

      expect(result.map((p) => p.skuId)).toEqual(['active-priced']);
      expect(result[0]!.currency).toBe('NGN');
      expect(result[0]!.sellingPrice).toBe(500);
      expect(result[0]!.available).toBe(true);
    });
  });

  describe('cart operations', () => {
    it('addItemToCart merges quantity into an existing line for the same product', async () => {
      const { service } = makeService([makeProduct({ id: 'chips' })]);
      const cart1 = await service.addItemToCart(ORG_A, [], 'chips', 2);
      const cart2 = await service.addItemToCart(ORG_A, cart1, 'chips', 3);
      expect(cart2).toEqual([{ productId: 'chips', quantity: 5 }]);
    });

    it('addItemToCart rejects an unknown or cross-tenant productId', async () => {
      const { service } = makeService([makeProduct({ id: 'chips' })]);
      await expect(service.addItemToCart(ORG_B, [], 'chips', 1)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('addItemToCart/updateCartItem reject a non-positive or non-integer quantity', async () => {
      const { service } = makeService([makeProduct({ id: 'chips' })]);
      await expect(service.addItemToCart(ORG_A, [], 'chips', 0)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.addItemToCart(ORG_A, [], 'chips', -1)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.addItemToCart(ORG_A, [], 'chips', 1.5)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('updateCartItem sets an exact quantity, and rejects a productId not already in the cart', async () => {
      const { service } = makeService([makeProduct({ id: 'chips' })]);
      const cart = await service.addItemToCart(ORG_A, [], 'chips', 2);
      const updated = await service.updateCartItem(ORG_A, cart, 'chips', 10);
      expect(updated).toEqual([{ productId: 'chips', quantity: 10 }]);
      await expect(service.updateCartItem(ORG_A, cart, 'not-in-cart', 1)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('removeCartItem is a pure filter — never throws, even for a productId not present', () => {
      const { service } = makeService([]);
      expect(service.removeCartItem([{ productId: 'a', quantity: 1 }], 'a')).toEqual([]);
      expect(service.removeCartItem([{ productId: 'a', quantity: 1 }], 'b')).toEqual([
        { productId: 'a', quantity: 1 },
      ]);
    });

    it('getCartSummary computes the live subtotal and drops a line whose product became unavailable', async () => {
      const chips = makeProduct({ id: 'chips', sellingPrice: 500 });
      const { service } = makeService([chips]);
      const cart = [
        { productId: 'chips', quantity: 2 },
        { productId: 'gone', quantity: 1 },
      ];
      const result = await service.getCartSummary(ORG_A, cart);
      expect(result.summary.subtotal).toBe(1000);
      expect(result.cart).toEqual([{ productId: 'chips', quantity: 2 }]);
      expect(result.removedProductIds).toEqual(['gone']);
    });
  });

  describe('confirmOrder', () => {
    it('rejects an unknown consumer and an empty cart', async () => {
      const { service } = makeService([makeProduct({ id: 'chips' })], []);
      await expect(
        service.confirmOrder(ORG_A, 'no-such-consumer', [{ productId: 'chips', quantity: 1 }], 'k'),
      ).rejects.toThrow(NotFoundException);

      const consumer = { id: 'c1', organisationId: ORG_A } as Consumer;
      const { service: service2 } = makeService([makeProduct({ id: 'chips' })], [consumer]);
      await expect(service2.confirmOrder(ORG_A, 'c1', [], 'k')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects with CartItemUnavailableError when a cart line is no longer orderable, deferring the exact re-validation to SalesOrderService as the final authority', async () => {
      const consumer = { id: 'c1', organisationId: ORG_A } as Consumer;
      const { service } = makeService([], [consumer]);
      await expect(
        service.confirmOrder(ORG_A, 'c1', [{ productId: 'does-not-exist', quantity: 1 }], 'k'),
      ).rejects.toThrow(CartItemUnavailableError);
    });

    it('delegates order creation entirely to SalesOrderService.createForConsumer, passing only productId/quantity — never a price', async () => {
      const consumer = { id: 'c1', organisationId: ORG_A } as Consumer;
      const chips = makeProduct({ id: 'chips', sellingPrice: 500 });
      const { service, salesOrderService } = makeService([chips], [consumer]);
      salesOrderService.createForConsumer.mockResolvedValue({
        order: {
          id: 'order-1',
          orderCode: 'SO-000001',
          orderDate: new Date('2026-09-28'),
          status: 'DRAFT',
          items: [
            { product: { name: 'Plantain Chips' }, quantity: 2, unitPrice: 500, lineTotal: 1000 },
          ],
          subtotal: 1000,
          total: 1000,
        } as never,
        wasCreated: true,
      });

      const { result, wasCreated } = await service.confirmOrder(
        ORG_A,
        'c1',
        [{ productId: 'chips', quantity: 2 }],
        'idem-1',
      );

      expect(wasCreated).toBe(true);
      expect(result.orderCode).toBe('SO-000001');
      expect(result.currency).toBe('NGN');
      const callArg = salesOrderService.createForConsumer.mock.calls[0]![1];
      expect(callArg).toMatchObject({
        consumerId: 'c1',
        items: [{ productId: 'chips', quantity: 2 }],
        idempotencyKey: 'idem-1',
      });
      expect(callArg).not.toHaveProperty('unitPrice');
    });
  });

  describe('getConsumerOrder — ownership enforcement', () => {
    it('returns the order when it belongs to the requesting consumer', async () => {
      const { service, salesOrderService } = makeService([]);
      salesOrderService.getById.mockResolvedValue({
        id: 'order-1',
        consumerId: 'c1',
        orderCode: 'SO-000001',
        orderDate: new Date('2026-09-28'),
        status: 'DRAFT',
        items: [],
        subtotal: 0,
        total: 0,
      } as never);

      const result = await service.getConsumerOrder(ORG_A, 'c1', 'order-1');
      expect(result.orderId).toBe('order-1');
    });

    it('rejects (404, never leaking which case) when the order belongs to a DIFFERENT consumer', async () => {
      const { service, salesOrderService } = makeService([]);
      salesOrderService.getById.mockResolvedValue({
        id: 'order-1',
        consumerId: 'someone-else',
        orderCode: 'SO-000001',
        orderDate: new Date('2026-09-28'),
        status: 'DRAFT',
        items: [],
        subtotal: 0,
        total: 0,
      } as never);

      await expect(service.getConsumerOrder(ORG_A, 'c1', 'order-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects (404) when the order does not exist at all', async () => {
      const { service, salesOrderService } = makeService([]);
      salesOrderService.getById.mockRejectedValue(new NotFoundException('Sales order not found'));
      await expect(service.getConsumerOrder(ORG_A, 'c1', 'no-such-order')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
