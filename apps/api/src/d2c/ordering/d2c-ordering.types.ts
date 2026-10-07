/**
 * Sprint 34 — D2C Consumer Ordering (docs/domains/d2c.md "D2C Ordering Architecture").
 * The channel-neutral application contract between the Conversation Layer and
 * `D2COrderingService` (brief §14) — a future WhatsApp adapter and the Sprint 42
 * simulator both operate on exactly these shapes, never a raw Prisma `Product`/
 * `SalesOrder`.
 */

/** One D2C-orderable product — see `D2COrderingService.isOrderable` for the exact
 *  eligibility rule (`status === ACTIVE && type === FINISHED_PRODUCT &&
 *  sellingPrice !== null`). Every product returned by `getAvailableProducts` already
 *  satisfies this, so `available` is always `true` here — the field exists so the
 *  conversation contract has a single product shape whether or not a future extension
 *  ever needs to surface a `false` (e.g. "temporarily out of stock") case. */
export interface D2CProductOption {
  skuId: string;
  productName: string;
  variantName: string | null;
  displayName: string | null;
  sellingPrice: number;
  currency: string;
  available: true;
  /** Added Sprint 41 — `Product.imageUrl`, surfaced so a channel adapter can show a
   *  product photo at selection time (brief §18). `null` when the product has none; a
   *  channel adapter must fall back to text-only rather than block ordering on it. */
  imageUrl: string | null;
}

/** The Conversation Layer's own persisted cart shape (`context.cart` — never a database
 *  table, brief §4 "do not build persistent shopping cart infrastructure"). Deliberately
 *  has no price: a cart line is a request, never authoritative. */
export interface CartLine {
  productId: string;
  quantity: number;
}

export interface CartSummaryLine {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface CartSummary {
  lines: CartSummaryLine[];
  subtotal: number;
  currency: string;
}

/** Returned by `D2COrderingService.getCartSummary` — `removedProductIds` is non-empty
 *  only when a cart line's product became unavailable between when it was added and
 *  now (brief §15 "Product becomes unavailable before confirmation"); the Conversation
 *  Layer persists `cart` (the trimmed line list) back into `context.cart` and shows the
 *  consumer the brief's exact wording before letting them proceed. */
export interface CartSummaryResult {
  summary: CartSummary;
  cart: CartLine[];
  removedProductIds: string[];
}

export interface D2COrderResultItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

/** The order result the Conversation Layer renders after confirmation (brief §12
 *  "Order Lookup") — never a raw `SalesOrder`. `status` is the real Sales Order status
 *  string (`DRAFT` this sprint); the Conversation Layer, not this service, is
 *  responsible for any consumer-facing wording like "Awaiting Payment" (brief §6/§19 —
 *  wording belongs to the conversation response contract, not business logic). */
export interface D2COrderResult {
  orderId: string;
  orderCode: string;
  orderDate: Date;
  status: string;
  items: D2COrderResultItem[];
  subtotal: number;
  total: number;
  currency: string;
  /** Added Sprint 42 — D2C Collection Point Fulfilment & Order Completion (brief §32/33
   *  "Consumer Status Refresh"). A consumer-facing label derived from the EXISTING,
   *  authoritative `CollectionPointFulfillment.status` (Sprint 37) — `null` only when
   *  this order has never been assigned to a Collection Point at all (still awaiting
   *  assignment, or not a Collection-Point-fulfilled order), never a second,
   *  independently-tracked WhatsApp-only status. */
  fulfilmentStatus: string | null;
  /** The assigned Collection Point's own `Outlet.name` — `null` under the same condition
   *  as `fulfilmentStatus`. */
  collectionPointName: string | null;
}
