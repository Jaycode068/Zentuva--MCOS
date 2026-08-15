/**
 * Identity Domain seed script.
 *
 * Seeds the "Boby Bites" pilot organisation, its three system roles (Owner,
 * Administrator, Member — identity.md §6), the full permission catalog (identity.md §6),
 * and one development account per system role — Owner, Administrator, and Member (the
 * latter two added Sprint 2.2 for User Management testing: role-based authorisation needs
 * a real Administrator and a real Member to test against, not just the Owner).
 *
 * Runs as a plain Node script via ts-node (`prisma db seed`), outside the NestJS DI
 * container — the standard Prisma seeding pattern. It talks to Prisma directly rather
 * than through the Identity domain services, because most of them (OrganisationService.
 * register, ...) are still stubs — see docs/sprint-1B.1-completion-report.md.
 *
 * Password hashing uses `bcrypt` directly (not the `PasswordHasher` port from
 * apps/api/src/identity/crypto/ — this script runs outside the Nest DI container, so it
 * can't inject it), matching the Authentication Layer's chosen hasher (Sprint 1B.2) so
 * the seeded admin user can actually log in. Originally seeded with `argon2` in Sprint
 * 1B.1, before the Authentication Layer settled on bcrypt — see
 * docs/sprint-1B.2-completion-report.md "Deviations".
 *
 * No credentials are hardcoded: every account's email and password come from required
 * environment variables and the script fails loudly if they're missing — see
 * apps/api/.env.example for the predictable local-development values (Sprint 2.2 brief:
 * "documented development passwords").
 */
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const BCRYPT_SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS ?? '12', 10);

const prisma = new PrismaClient();

const BOBY_BITES_SLUG = 'boby-bites';
const BOBY_BITES_ORGANISATION_CODE = 'BBT-0001';

/** Permission catalog — identity.md §6 "Permission naming convention" examples. */
const IDENTITY_PERMISSIONS = [
  { key: 'identity.users.read', domain: 'identity', description: 'View users in the organisation' },
  {
    key: 'identity.users.update',
    domain: 'identity',
    description: "Edit a user's profile / suspend / reactivate",
  },
  {
    key: 'identity.invitations.create',
    domain: 'identity',
    description: 'Invite a new user',
  },
  {
    key: 'identity.invitations.revoke',
    domain: 'identity',
    description: 'Cancel a pending invitation',
  },
  {
    key: 'identity.roles.manage',
    domain: 'identity',
    description: 'Create/edit/delete non-system roles',
  },
  {
    key: 'identity.roles.assign',
    domain: 'identity',
    description: 'Assign/unassign roles on users',
  },
  {
    key: 'identity.audit-logs.read',
    domain: 'identity',
    description: "View the organisation's audit log",
  },
] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. The seed script never hardcodes ` +
        'credentials — set it in apps/api/.env (see apps/api/.env.example) before running ' +
        '`pnpm db:seed`.',
    );
  }
  return value;
}

/** Seeds one development account (email/password from required env vars) and assigns it
 *  the given role. Added Sprint 2.2 to seed Administrator and Member accounts alongside
 *  the existing Owner, using the same "no hardcoded credentials" pattern. */
async function seedUser(params: {
  organisationId: string;
  roleId: string;
  emailEnvVar: string;
  passwordEnvVar: string;
  firstNameEnvVar: string;
  lastNameEnvVar: string;
  defaultFirstName: string;
  defaultLastName: string;
}) {
  const email = requireEnv(params.emailEnvVar);
  const password = requireEnv(params.passwordEnvVar);
  const firstName = process.env[params.firstNameEnvVar] ?? params.defaultFirstName;
  const lastName = process.env[params.lastNameEnvVar] ?? params.defaultLastName;

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      organisationId: params.organisationId,
      email,
      firstName,
      lastName,
      passwordHash,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: params.roleId } },
    update: {},
    create: { userId: user.id, roleId: params.roleId, organisationId: params.organisationId },
  });

  return user;
}

/** Five example Boby Bites products (Sprint 4.1 brief) — hardcoded codes/slugs, same
 *  "predictable seed data" convention as the organisation's own hardcoded
 *  `BOBY_BITES_ORGANISATION_CODE`, since the seed script runs outside the NestJS DI
 *  container and has no access to `ProductService.generateUniqueCode`. Seeded `ACTIVE`
 *  (not the `DRAFT` a real create-product call defaults to) so the demo catalogue reads as
 *  a working one, not five untouched drafts. No product images, per the brief. */
const BOBY_BITES_PRODUCTS = [
  {
    code: 'PRD-000001',
    name: 'Plantain Chips',
    slug: 'plantain-chips',
    category: 'SNACKS',
    type: 'FINISHED_PRODUCT',
    unit: 'Pack',
  },
  {
    code: 'PRD-000002',
    name: 'Potato Chips',
    slug: 'potato-chips',
    category: 'SNACKS',
    type: 'FINISHED_PRODUCT',
    unit: 'Pack',
  },
  {
    code: 'PRD-000003',
    name: 'Roasted Groundnut',
    slug: 'roasted-groundnut',
    category: 'SNACKS',
    type: 'FINISHED_PRODUCT',
    unit: 'Sachet',
  },
  {
    code: 'PRD-000004',
    name: 'Kulikuli',
    slug: 'kulikuli',
    category: 'SNACKS',
    type: 'FINISHED_PRODUCT',
    unit: 'Sachet',
  },
  {
    code: 'PRD-000005',
    name: 'Chin Chin',
    slug: 'chin-chin',
    category: 'SNACKS',
    type: 'FINISHED_PRODUCT',
    unit: 'Pack',
  },
  /// Sprint 4.3 additions — raw material/packaging inputs a Purchase Order can actually
  /// reference (`PurchaseOrderService` rejects Finished Products), one per supplier
  /// category so the seeded POs below line up with a real supplier→input relationship.
  /// Plantain/Vegetable Oil/Printed Nylon deliberately use `PRD-000011`–`-000013`, not
  /// `-000006`–`-000008` — this dev database already has organically-created products
  /// (via live browser/API testing in Sprints 4.1/4.2) occupying those codes, and this
  /// upsert is keyed by `code`, so reusing them would silently no-op against the wrong,
  /// unrelated product instead of creating these. Salt/Cartons keep `-000009`/`-000010`,
  /// which were genuinely free.
  {
    code: 'PRD-000011',
    name: 'Plantain',
    slug: 'plantain',
    category: 'RAW_MATERIALS',
    type: 'RAW_MATERIAL',
    unit: 'Kilogram',
  },
  {
    code: 'PRD-000012',
    name: 'Vegetable Oil',
    slug: 'vegetable-oil',
    category: 'RAW_MATERIALS',
    type: 'RAW_MATERIAL',
    unit: 'Litre',
  },
  {
    code: 'PRD-000013',
    name: 'Printed Nylon',
    slug: 'printed-nylon',
    category: 'PACKAGING',
    type: 'PACKAGING_MATERIAL',
    unit: 'Roll',
  },
  {
    code: 'PRD-000009',
    name: 'Salt',
    slug: 'salt',
    category: 'RAW_MATERIALS',
    type: 'RAW_MATERIAL',
    unit: 'Kilogram',
  },
  {
    code: 'PRD-000010',
    name: 'Cartons',
    slug: 'cartons',
    category: 'PACKAGING',
    type: 'PACKAGING_MATERIAL',
    unit: 'Piece',
  },
] as const;

/** Returns a `code -> id` map so `seedPurchaseOrders` can reference the products it just
 *  seeded without a second round-trip lookup. */
async function seedProducts(
  organisationId: string,
  actorUserId: string,
): Promise<Record<string, string>> {
  console.log('Seeding Product Catalogue (10 Boby Bites products)...');
  const productsByCode: Record<string, string> = {};
  for (const product of BOBY_BITES_PRODUCTS) {
    const created = await prisma.product.upsert({
      where: { code: product.code },
      update: {},
      create: {
        organisationId,
        code: product.code,
        name: product.name,
        slug: product.slug,
        category: product.category,
        type: product.type,
        unit: product.unit,
        status: 'ACTIVE',
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    });
    productsByCode[product.code] = created.id;
  }
  return productsByCode;
}

/** Five example Boby Bites suppliers (Sprint 4.2 brief) — hardcoded codes, same
 *  "predictable seed data" convention as `BOBY_BITES_PRODUCTS`, since the seed script runs
 *  outside the NestJS DI container and has no access to `SupplierService.
 *  generateUniqueCode`. All seeded `ACTIVE`, matching what they'd default to via a real
 *  `POST /api/suppliers` call. */
const BOBY_BITES_SUPPLIERS = [
  {
    supplierCode: 'SUP-000001',
    supplierName: 'Fresh Farms Ltd',
    contactPerson: 'Chidi Okafor',
    email: 'sales@freshfarms.test',
    phoneNumber: '+234 801 234 5678',
    country: 'Nigeria',
    state: 'Oyo',
    city: 'Ibadan',
    supplierCategory: 'RAW_MATERIAL',
    notes: 'Supplies plantain.',
  },
  {
    supplierCode: 'SUP-000002',
    supplierName: 'Golden Oil Ltd',
    contactPerson: 'Amina Bello',
    email: 'orders@goldenoil.test',
    phoneNumber: '+234 802 345 6789',
    country: 'Nigeria',
    state: 'Kaduna',
    city: 'Kaduna',
    supplierCategory: 'RAW_MATERIAL',
    notes: 'Supplies vegetable oil.',
  },
  {
    supplierCode: 'SUP-000003',
    supplierName: 'PackRight Nigeria',
    contactPerson: 'Emeka Nwosu',
    email: 'info@packright.test',
    phoneNumber: '+234 803 456 7890',
    country: 'Nigeria',
    state: 'Lagos',
    city: 'Lagos',
    supplierCategory: 'PACKAGING',
    notes: 'Supplies printed nylon and labels.',
  },
  {
    supplierCode: 'SUP-000004',
    supplierName: 'Salt Masters Ltd',
    contactPerson: 'Fatima Yusuf',
    email: 'sales@saltmasters.test',
    phoneNumber: '+234 804 567 8901',
    country: 'Nigeria',
    state: 'Ebonyi',
    city: 'Abakaliki',
    supplierCategory: 'RAW_MATERIAL',
    notes: 'Supplies salt.',
  },
  {
    supplierCode: 'SUP-000005',
    supplierName: 'Lagos Cartons Ltd',
    contactPerson: 'Tunde Adeyemi',
    email: 'info@lagoscartons.test',
    phoneNumber: '+234 805 678 9012',
    country: 'Nigeria',
    state: 'Lagos',
    city: 'Lagos',
    supplierCategory: 'PACKAGING',
    notes: 'Supplies cartons.',
  },
] as const;

/** Returns a `supplierCode -> id` map so `seedPurchaseOrders` can reference the suppliers
 *  it just seeded without a second round-trip lookup. */
async function seedSuppliers(
  organisationId: string,
  actorUserId: string,
): Promise<Record<string, string>> {
  console.log('Seeding Supplier Management (5 Boby Bites suppliers)...');
  const suppliersByCode: Record<string, string> = {};
  for (const supplier of BOBY_BITES_SUPPLIERS) {
    const created = await prisma.supplier.upsert({
      where: { supplierCode: supplier.supplierCode },
      update: {},
      create: {
        organisationId,
        supplierCode: supplier.supplierCode,
        supplierName: supplier.supplierName,
        contactPerson: supplier.contactPerson,
        email: supplier.email,
        phoneNumber: supplier.phoneNumber,
        country: supplier.country,
        state: supplier.state,
        city: supplier.city,
        supplierCategory: supplier.supplierCategory,
        notes: supplier.notes,
        status: 'ACTIVE',
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    });
    suppliersByCode[supplier.supplierCode] = created.id;
  }
  return suppliersByCode;
}

/** Six example Boby Bites purchase orders — the original three from Sprint 4.3
 *  (`PENDING`/`DRAFT`/`CANCELLED`, unchanged) plus three added Sprint 4.4.1 so
 *  `seedGoodsReceipts` below has enough purchase orders to demonstrate every receiving
 *  scenario the brief calls for (§16): a short delivery (`PO-000009`), a delivery with
 *  rejected goods followed by a replacement (`PO-000010`), and an excess delivery
 *  (`PO-000011`). All three start `PENDING`; `seedGoodsReceipts` drives their status to
 *  `PARTIALLY_RECEIVED`/`RECEIVED` the same way a real receive would. */
const BOBY_BITES_PURCHASE_ORDERS = [
  {
    purchaseOrderNumber: 'PO-000001',
    supplierCode: 'SUP-000001',
    orderDate: new Date('2026-07-20'),
    expectedDeliveryDate: new Date('2026-08-05'),
    status: 'PENDING',
    remarks: 'Restocking plantain for the next production run.',
    items: [{ productCode: 'PRD-000011', quantity: 2000, unitPrice: 350 }],
  },
  {
    purchaseOrderNumber: 'PO-000002',
    supplierCode: 'SUP-000002',
    orderDate: new Date('2026-07-28'),
    expectedDeliveryDate: null,
    status: 'DRAFT',
    remarks: 'Draft — confirming quantity with production before issuing.',
    items: [{ productCode: 'PRD-000012', quantity: 500, unitPrice: 1200 }],
  },
  {
    purchaseOrderNumber: 'PO-000003',
    supplierCode: 'SUP-000003',
    orderDate: new Date('2026-07-15'),
    expectedDeliveryDate: new Date('2026-07-25'),
    status: 'CANCELLED',
    remarks: 'Cancelled — switched to an alternate packaging supplier for this batch.',
    items: [{ productCode: 'PRD-000013', quantity: 1000, unitPrice: 150 }],
  },
  {
    purchaseOrderNumber: 'PO-000009',
    supplierCode: 'SUP-000004',
    orderDate: new Date('2026-08-01'),
    expectedDeliveryDate: new Date('2026-08-10'),
    status: 'PENDING',
    remarks: 'Salt for the next seasoning batch.',
    items: [{ productCode: 'PRD-000009', quantity: 500, unitPrice: 200 }],
  },
  {
    purchaseOrderNumber: 'PO-000010',
    supplierCode: 'SUP-000005',
    orderDate: new Date('2026-07-25'),
    expectedDeliveryDate: new Date('2026-08-03'),
    status: 'PENDING',
    remarks: 'Cartons for finished-goods packing.',
    items: [{ productCode: 'PRD-000010', quantity: 1000, unitPrice: 90 }],
  },
  {
    purchaseOrderNumber: 'PO-000011',
    supplierCode: 'SUP-000003',
    orderDate: new Date('2026-07-30'),
    expectedDeliveryDate: new Date('2026-08-06'),
    status: 'PENDING',
    remarks: 'Reorder after PO-000003 was cancelled — new packaging spec.',
    items: [{ productCode: 'PRD-000013', quantity: 1000, unitPrice: 150 }],
  },
] as const;

interface SeededPurchaseOrder {
  id: string;
  /** `PurchaseOrderItem.id` keyed by product code — `seedGoodsReceipts` needs the real
   *  item id (not just the product code) since `GoodsReceiptItem.purchaseOrderItemId` is
   *  the actual foreign key, same as a real receive request. */
  itemIdByProductCode: Record<string, string>;
}

/** Returns a `purchaseOrderNumber -> {id, itemIdByProductCode}` map so
 *  `seedGoodsReceipts` can reference each order's real `PurchaseOrderItem` rows. */
async function seedPurchaseOrders(
  organisationId: string,
  actorUserId: string,
  productsByCode: Record<string, string>,
  suppliersByCode: Record<string, string>,
): Promise<Record<string, SeededPurchaseOrder>> {
  console.log('Seeding Procurement (6 Boby Bites purchase orders)...');
  const purchaseOrdersByNumber: Record<string, SeededPurchaseOrder> = {};
  for (const po of BOBY_BITES_PURCHASE_ORDERS) {
    const items = po.items.map((item) => ({
      productId: productsByCode[item.productCode]!,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.quantity * item.unitPrice,
    }));
    const total = items.reduce((sum, item) => sum + item.lineTotal, 0);

    await prisma.purchaseOrder.upsert({
      where: { purchaseOrderNumber: po.purchaseOrderNumber },
      update: {},
      create: {
        organisationId,
        purchaseOrderNumber: po.purchaseOrderNumber,
        supplierId: suppliersByCode[po.supplierCode]!,
        orderDate: po.orderDate,
        expectedDeliveryDate: po.expectedDeliveryDate,
        status: po.status,
        remarks: po.remarks,
        subtotal: total,
        total,
        createdById: actorUserId,
        updatedById: actorUserId,
        items: { create: items },
      },
    });

    const created = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { purchaseOrderNumber: po.purchaseOrderNumber },
      include: { items: true },
    });
    const itemIdByProductCode: Record<string, string> = {};
    for (const item of po.items) {
      const productId = productsByCode[item.productCode]!;
      const matched = created.items.find((row) => row.productId === productId);
      if (matched) {
        itemIdByProductCode[item.productCode] = matched.id;
      }
    }
    purchaseOrdersByNumber[po.purchaseOrderNumber] = { id: created.id, itemIdByProductCode };
  }
  return purchaseOrdersByNumber;
}

/** Five example Boby Bites goods receipts (Sprint 4.4.1 brief §16) spanning every
 *  receiving scenario the brief calls for:
 *  - `GRN-000001` against `PO-000001` — a complete, perfect delivery (Scenario A).
 *  - `GRN-000002` against `PO-000009` — a short delivery, order stays open
 *    (Scenario B / `PARTIALLY_RECEIVED`).
 *  - `GRN-000003` against `PO-000010` — full quantity delivered but partly rejected
 *    (Scenario C); `GRN-000004`, also against `PO-000010`, is the supplier's later
 *    replacement for exactly the rejected quantity (brief §6) — together they
 *    demonstrate a Purchase Order receiving more than once.
 *  - `GRN-000005` against `PO-000011` — the supplier delivered more than ordered
 *    (Scenario E), accepted in full, never capped.
 *  `PO-000002`/`PO-000003` stay `DRAFT`/`CANCELLED` and are deliberately never
 *  receiving targets here — same rule `InventoryService.receiveGoods` enforces. */
const BOBY_BITES_GOODS_RECEIPTS = [
  {
    goodsReceiptNumber: 'GRN-000001',
    purchaseOrderNumber: 'PO-000001',
    receivedDate: new Date('2026-08-05'),
    remarks: 'Full delivery received in good condition — matches the purchase order exactly.',
    items: [
      {
        productCode: 'PRD-000011',
        deliveredQuantity: 2000,
        rejectedQuantity: 0,
        rejectionReason: undefined,
        rejectionNotes: undefined,
      },
    ],
  },
  {
    goodsReceiptNumber: 'GRN-000002',
    purchaseOrderNumber: 'PO-000009',
    receivedDate: new Date('2026-08-08'),
    remarks: 'Supplier short-shipped this delivery — 50kg still outstanding.',
    items: [
      {
        productCode: 'PRD-000009',
        deliveredQuantity: 450,
        rejectedQuantity: 0,
        rejectionReason: undefined,
        rejectionNotes: undefined,
      },
    ],
  },
  {
    goodsReceiptNumber: 'GRN-000003',
    purchaseOrderNumber: 'PO-000010',
    receivedDate: new Date('2026-08-01'),
    remarks: 'Full quantity delivered, but 50 cartons arrived with crushed corners.',
    items: [
      {
        productCode: 'PRD-000010',
        deliveredQuantity: 1000,
        rejectedQuantity: 50,
        rejectionReason: 'DAMAGED' as const,
        rejectionNotes: 'Corners crushed in transit — unusable for packing.',
      },
    ],
  },
  {
    goodsReceiptNumber: 'GRN-000004',
    purchaseOrderNumber: 'PO-000010',
    receivedDate: new Date('2026-08-09'),
    remarks: 'Replacement for the 50 cartons rejected on GRN-000003.',
    items: [
      {
        productCode: 'PRD-000010',
        deliveredQuantity: 50,
        rejectedQuantity: 0,
        rejectionReason: undefined,
        rejectionNotes: undefined,
      },
    ],
  },
  {
    goodsReceiptNumber: 'GRN-000005',
    purchaseOrderNumber: 'PO-000011',
    receivedDate: new Date('2026-08-07'),
    remarks: 'Supplier sent more than ordered — excess accepted for the next production run.',
    items: [
      {
        productCode: 'PRD-000013',
        deliveredQuantity: 1100,
        rejectedQuantity: 0,
        rejectionReason: undefined,
        rejectionNotes: undefined,
      },
    ],
  },
] as const;

/** Mirrors `GoodsReceiptRepository.receive`'s transaction (recompute each item's
 *  cumulative delivered quantity, decide `PARTIALLY_RECEIVED` vs `RECEIVED`, create
 *  GoodsReceipt + items, increment `InventoryStock` by *accepted* quantity, append
 *  `InventoryTransaction` RECEIPT rows) rather than calling through the NestJS service
 *  layer — same "talks to Prisma directly" convention as the rest of this script.
 *  Idempotent on re-run: skips any GRN that already exists. `GRN-000004` (the
 *  replacement for `GRN-000003`'s rejected cartons) is seeded *after* `GRN-000003`
 *  precisely so its "cumulative delivered" calculation sees the first receipt's totals —
 *  same order a real user would receive them in. */
async function seedGoodsReceipts(
  organisationId: string,
  actorUserId: string,
  productsByCode: Record<string, string>,
  purchaseOrdersByNumber: Record<string, SeededPurchaseOrder>,
): Promise<void> {
  console.log('Seeding Inventory (5 Boby Bites goods receipts across 4 purchase orders)...');
  for (const grn of BOBY_BITES_GOODS_RECEIPTS) {
    const existing = await prisma.goodsReceipt.findUnique({
      where: { goodsReceiptNumber: grn.goodsReceiptNumber },
    });
    if (existing) {
      continue;
    }

    const purchaseOrder = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { purchaseOrderNumber: grn.purchaseOrderNumber },
      include: { items: true },
    });
    const seededPurchaseOrder = purchaseOrdersByNumber[grn.purchaseOrderNumber]!;

    const items = grn.items.map((item) => ({
      purchaseOrderItemId: seededPurchaseOrder.itemIdByProductCode[item.productCode]!,
      productId: productsByCode[item.productCode]!,
      deliveredQuantity: item.deliveredQuantity,
      rejectedQuantity: item.rejectedQuantity,
      acceptedQuantity: item.deliveredQuantity - item.rejectedQuantity,
      rejectionReason: item.rejectionReason,
      rejectionNotes: item.rejectionNotes,
    }));
    const hasDiscrepancy = items.some((item) => item.rejectedQuantity > 0);

    await prisma.$transaction(async (tx) => {
      const priorTotalsRows = await tx.goodsReceiptItem.groupBy({
        by: ['purchaseOrderItemId'],
        where: { goodsReceipt: { organisationId, purchaseOrderId: purchaseOrder.id } },
        _sum: { deliveredQuantity: true },
      });
      const priorDelivered = new Map(
        priorTotalsRows.map((row) => [row.purchaseOrderItemId, row._sum.deliveredQuantity ?? 0]),
      );
      const newlyDelivered = new Map<string, number>();
      for (const item of items) {
        newlyDelivered.set(
          item.purchaseOrderItemId,
          (newlyDelivered.get(item.purchaseOrderItemId) ?? 0) + item.deliveredQuantity,
        );
      }
      const fullyDelivered = purchaseOrder.items.every((poItem) => {
        const cumulative =
          (priorDelivered.get(poItem.id) ?? 0) + (newlyDelivered.get(poItem.id) ?? 0);
        return cumulative >= poItem.quantity;
      });
      const newStatus = fullyDelivered ? 'RECEIVED' : 'PARTIALLY_RECEIVED';

      await tx.purchaseOrder.update({
        where: { id: purchaseOrder.id },
        data: { status: newStatus, updatedById: actorUserId },
      });

      const goodsReceipt = await tx.goodsReceipt.create({
        data: {
          organisationId,
          goodsReceiptNumber: grn.goodsReceiptNumber,
          purchaseOrderId: purchaseOrder.id,
          supplierId: purchaseOrder.supplierId,
          receivedDate: grn.receivedDate,
          receivedById: actorUserId,
          remarks: grn.remarks,
          discrepancyStatus: hasDiscrepancy ? 'PENDING_SUPPLIER' : 'NONE',
          items: { create: items },
        },
      });

      const acceptedItems = items.filter((item) => item.acceptedQuantity > 0);
      for (const item of acceptedItems) {
        await tx.inventoryStock.upsert({
          where: { organisationId_productId: { organisationId, productId: item.productId } },
          create: {
            organisationId,
            productId: item.productId,
            quantityOnHand: item.acceptedQuantity,
          },
          update: { quantityOnHand: { increment: item.acceptedQuantity } },
        });
      }
      if (acceptedItems.length > 0) {
        await tx.inventoryTransaction.createMany({
          data: acceptedItems.map((item) => ({
            organisationId,
            productId: item.productId,
            transactionType: 'RECEIPT',
            quantity: item.acceptedQuantity,
            referenceType: 'GoodsReceipt',
            referenceId: goodsReceipt.id,
          })),
        });
      }
    });
  }

  // GRN-000004 fully replaces the 50 cartons GRN-000003 rejected — mark that original
  // discrepancy Resolved so the seed data demonstrates the complete lifecycle (brief
  // §13's "Receiving History" example), not just the "still pending" half of it.
  await prisma.goodsReceipt.updateMany({
    where: { goodsReceiptNumber: 'GRN-000003' },
    data: {
      discrepancyStatus: 'RESOLVED',
      discrepancyNotes: 'Replacement received in full via GRN-000004.',
    },
  });
}

async function main(): Promise<void> {
  // Read early (rather than inside `seedUser`) because the organisation's `businessEmail`
  // needs it before any user is created.
  const adminEmail = requireEnv('SEED_ADMIN_EMAIL');

  console.log('Seeding permission catalog...');
  const permissions = await Promise.all(
    IDENTITY_PERMISSIONS.map((permission) =>
      prisma.permission.upsert({
        where: { key: permission.key },
        update: { domain: permission.domain, description: permission.description },
        create: permission,
      }),
    ),
  );

  console.log('Seeding organisation "Boby Bites"...');
  const organisation = await prisma.organisation.upsert({
    where: { slug: BOBY_BITES_SLUG },
    update: {},
    create: {
      name: 'Boby Bites',
      slug: BOBY_BITES_SLUG,
      organisationCode: BOBY_BITES_ORGANISATION_CODE,
      businessEmail: adminEmail,
      country: 'Nigeria',
      status: 'ACTIVE',
    },
  });

  console.log('Seeding system roles (Owner, Administrator, Member)...');
  const ownerRole = await prisma.role.upsert({
    where: { organisationId_name: { organisationId: organisation.id, name: 'Owner' } },
    update: {},
    create: {
      organisationId: organisation.id,
      name: 'Owner',
      description: 'Full control. Bypasses the permission catalog entirely — identity.md §6.',
      isSystem: true,
    },
  });
  const administratorRole = await prisma.role.upsert({
    where: { organisationId_name: { organisationId: organisation.id, name: 'Administrator' } },
    update: {},
    create: {
      organisationId: organisation.id,
      name: 'Administrator',
      description: 'Day-to-day organisation management — identity.md §6.',
      isSystem: true,
    },
  });
  const memberRole = await prisma.role.upsert({
    where: { organisationId_name: { organisationId: organisation.id, name: 'Member' } },
    update: {},
    create: {
      organisationId: organisation.id,
      name: 'Member',
      description: 'Baseline authenticated user with no special permissions — identity.md §6.',
      isSystem: true,
    },
  });

  // Owner deliberately gets no explicit RolePermission rows — it bypasses the catalog
  // entirely at authorization-evaluation time (identity.md §6). Administrator gets every
  // seeded permission, matching its "day-to-day organisation management" scope.
  console.log('Granting the permission catalog to the Administrator role...');
  await prisma.rolePermission.createMany({
    data: permissions.map((permission) => ({
      roleId: administratorRole.id,
      permissionId: permission.id,
    })),
    skipDuplicates: true,
  });

  console.log('Seeding development accounts (Owner, Administrator, Member)...');
  const ownerUser = await seedUser({
    organisationId: organisation.id,
    roleId: ownerRole.id,
    emailEnvVar: 'SEED_ADMIN_EMAIL',
    passwordEnvVar: 'SEED_ADMIN_PASSWORD',
    firstNameEnvVar: 'SEED_ADMIN_FIRST_NAME',
    lastNameEnvVar: 'SEED_ADMIN_LAST_NAME',
    defaultFirstName: 'Organisation',
    defaultLastName: 'Owner',
  });
  const administratorUser = await seedUser({
    organisationId: organisation.id,
    roleId: administratorRole.id,
    emailEnvVar: 'SEED_ADMINISTRATOR_EMAIL',
    passwordEnvVar: 'SEED_ADMINISTRATOR_PASSWORD',
    firstNameEnvVar: 'SEED_ADMINISTRATOR_FIRST_NAME',
    lastNameEnvVar: 'SEED_ADMINISTRATOR_LAST_NAME',
    defaultFirstName: 'Boby',
    defaultLastName: 'Admin',
  });
  const memberUser = await seedUser({
    organisationId: organisation.id,
    roleId: memberRole.id,
    emailEnvVar: 'SEED_MEMBER_EMAIL',
    passwordEnvVar: 'SEED_MEMBER_PASSWORD',
    firstNameEnvVar: 'SEED_MEMBER_FIRST_NAME',
    lastNameEnvVar: 'SEED_MEMBER_LAST_NAME',
    defaultFirstName: 'Boby',
    defaultLastName: 'Member',
  });

  const productsByCode = await seedProducts(organisation.id, ownerUser.id);
  const suppliersByCode = await seedSuppliers(organisation.id, ownerUser.id);
  const purchaseOrdersByNumber = await seedPurchaseOrders(
    organisation.id,
    ownerUser.id,
    productsByCode,
    suppliersByCode,
  );
  await seedGoodsReceipts(organisation.id, ownerUser.id, productsByCode, purchaseOrdersByNumber);

  console.log('Recording an audit log entry for this seed run...');
  await prisma.auditLog.create({
    data: {
      organisationId: organisation.id,
      actorUserId: ownerUser.id,
      action: 'organisation.seeded',
      entityType: 'Organisation',
      entityId: organisation.id,
      metadata: { seededBy: 'prisma/seed.ts', roles: ['Owner', 'Administrator', 'Member'] },
    },
  });

  console.log('Seed complete:', {
    organisation: organisation.slug,
    organisationCode: organisation.organisationCode,
    ownerEmail: ownerUser.email,
    administratorEmail: administratorUser.email,
    memberEmail: memberUser.email,
    permissionsSeeded: permissions.length,
    productsSeeded: BOBY_BITES_PRODUCTS.length,
    suppliersSeeded: BOBY_BITES_SUPPLIERS.length,
    purchaseOrdersSeeded: BOBY_BITES_PURCHASE_ORDERS.length,
    goodsReceiptsSeeded: BOBY_BITES_GOODS_RECEIPTS.length,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
