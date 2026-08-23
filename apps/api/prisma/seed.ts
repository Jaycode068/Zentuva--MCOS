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

/** Two example Boby Bites stock locations (Sprint 4.5 brief §16/§20) — "Main Warehouse"
 *  is the organisation's default (same one `InventoryLocationRepository.getOrCreateDefault`
 *  would lazily create if this script never ran); "Cold Storage" exists purely so the
 *  Locations tab and the Inventory Summary's location filter have more than one row to
 *  demonstrate against. Looked up by `(organisationId, name)` rather than upserted by a
 *  unique key — `InventoryLocation.name` isn't globally or per-org unique at the schema
 *  level (brief didn't ask for that constraint) — so this checks for an existing row
 *  first, matching the "idempotent on re-run" convention every other seed function here
 *  uses. */
const BOBY_BITES_INVENTORY_LOCATIONS = [
  { name: 'Main Warehouse', isDefault: true },
  { name: 'Cold Storage', isDefault: false },
] as const;

/** Returns a `name -> id` map so `seedGoodsReceipts`/`seedInventoryAdjustment` can
 *  reference these locations without a second round-trip lookup. */
async function seedInventoryLocations(
  organisationId: string,
  actorUserId: string,
): Promise<Record<string, string>> {
  console.log('Seeding Inventory Locations (Main Warehouse + Cold Storage)...');
  const locationsByName: Record<string, string> = {};
  for (const location of BOBY_BITES_INVENTORY_LOCATIONS) {
    const existing = await prisma.inventoryLocation.findFirst({
      where: { organisationId, name: location.name },
    });
    const created =
      existing ??
      (await prisma.inventoryLocation.create({
        data: {
          organisationId,
          name: location.name,
          status: 'ACTIVE',
          isDefault: location.isDefault,
          createdById: actorUserId,
          updatedById: actorUserId,
        },
      }));
    locationsByName[location.name] = created.id;
  }
  return locationsByName;
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
  defaultLocationId: string,
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
          locationId: defaultLocationId,
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
          where: {
            organisationId_productId_locationId: {
              organisationId,
              productId: item.productId,
              locationId: defaultLocationId,
            },
          },
          create: {
            organisationId,
            productId: item.productId,
            locationId: defaultLocationId,
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
            locationId: defaultLocationId,
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

/** One example manual stock adjustment (Sprint 4.5 brief §30 "idempotent seed data with
 *  ... at least one adjustment example") — a monthly physical count on Salt turning up
 *  5kg less than the ledger expects, corrected via `ADJUSTMENT` rather than editing
 *  `InventoryStock` directly, same rule `InventoryStockRepository.adjustStock` itself
 *  enforces. Idempotency is checked by matching on the exact
 *  `(organisationId, productId, locationId, transactionType, quantity)` tuple — this
 *  script has no natural unique business key for a manual adjustment the way
 *  `goodsReceiptNumber` gives goods receipts. */
async function seedInventoryAdjustment(
  organisationId: string,
  actorUserId: string,
  productId: string,
  locationId: string,
): Promise<void> {
  console.log('Seeding one example Inventory Adjustment (Salt physical count)...');
  const ADJUSTMENT_QUANTITY = -5;
  const existing = await prisma.inventoryTransaction.findFirst({
    where: {
      organisationId,
      productId,
      locationId,
      transactionType: 'ADJUSTMENT',
      quantity: ADJUSTMENT_QUANTITY,
    },
  });
  if (existing) {
    return;
  }

  const stock = await prisma.inventoryStock.findUnique({
    where: { organisationId_productId_locationId: { organisationId, productId, locationId } },
  });
  const newQuantity = (stock?.quantityOnHand ?? 0) + ADJUSTMENT_QUANTITY;
  if (newQuantity < 0) {
    // The goods-receiving seed data above must run first — skip quietly rather than
    // crashing the whole seed script if it somehow didn't.
    return;
  }

  await prisma.$transaction([
    prisma.inventoryStock.upsert({
      where: { organisationId_productId_locationId: { organisationId, productId, locationId } },
      create: { organisationId, productId, locationId, quantityOnHand: newQuantity },
      update: { quantityOnHand: newQuantity },
    }),
    prisma.inventoryTransaction.create({
      data: {
        organisationId,
        productId,
        locationId,
        transactionType: 'ADJUSTMENT',
        quantity: ADJUSTMENT_QUANTITY,
        referenceType: 'ManualAdjustment',
        adjustmentReason: 'PHYSICAL_COUNT',
        notes: 'Monthly stock count — 5kg discrepancy found, cause unknown.',
        createdById: actorUserId,
      },
    }),
  ]);
}

/** Tops up raw-material stock at Main Warehouse before seeding Production data (Sprint
 *  4.6 brief §30 "sufficient raw-material stock for availability/issue testing").
 *  Vegetable Oil has zero stock at this point (its only Purchase Order, `PO-000002`, is
 *  seeded `DRAFT` and never received) — every other input already carries stock from the
 *  Sprint 4.4.1 goods-receiving seed data, but is topped up too for headroom against the
 *  seeded Production Order plus a live "insufficient stock" test that over-requests
 *  against these same balances. Recorded as an `ADJUSTMENT`/`FOUND_STOCK` transaction
 *  (never written straight to `InventoryStock`), same rule `seedInventoryAdjustment`
 *  itself follows. Idempotent via a `referenceType: 'ProductionSeedTopUp'` existence
 *  check per product, since — unlike a goods receipt — a manual top-up has no natural
 *  unique business key. */
const PRODUCTION_RAW_MATERIAL_TOPUPS = [
  { productCode: 'PRD-000011', quantity: 1000 }, // Plantain
  { productCode: 'PRD-000012', quantity: 200 }, // Vegetable Oil
  { productCode: 'PRD-000009', quantity: 100 }, // Salt
  { productCode: 'PRD-000013', quantity: 500 }, // Printed Nylon
] as const;

async function seedProductionRawMaterialTopUp(
  organisationId: string,
  actorUserId: string,
  productsByCode: Record<string, string>,
  locationId: string,
): Promise<void> {
  console.log('Topping up raw-material stock for Production testing...');
  for (const topUp of PRODUCTION_RAW_MATERIAL_TOPUPS) {
    const productId = productsByCode[topUp.productCode]!;
    const existing = await prisma.inventoryTransaction.findFirst({
      where: { organisationId, productId, locationId, referenceType: 'ProductionSeedTopUp' },
    });
    if (existing) {
      continue;
    }

    const stock = await prisma.inventoryStock.findUnique({
      where: { organisationId_productId_locationId: { organisationId, productId, locationId } },
    });
    const newQuantity = (stock?.quantityOnHand ?? 0) + topUp.quantity;

    await prisma.$transaction([
      prisma.inventoryStock.upsert({
        where: { organisationId_productId_locationId: { organisationId, productId, locationId } },
        create: { organisationId, productId, locationId, quantityOnHand: newQuantity },
        update: { quantityOnHand: newQuantity },
      }),
      prisma.inventoryTransaction.create({
        data: {
          organisationId,
          productId,
          locationId,
          transactionType: 'ADJUSTMENT',
          quantity: topUp.quantity,
          referenceType: 'ProductionSeedTopUp',
          adjustmentReason: 'FOUND_STOCK',
          notes: 'Sprint 4.6 seed — raw material top-up for Production testing.',
          createdById: actorUserId,
        },
      }),
    ]);
  }
}

/** One active Bill of Materials for Plantain Chips (Sprint 4.6 brief §30) — component
 *  quantities are defined per `yieldQuantity: 1000` packs. Seeded `ACTIVE` directly
 *  (bypassing the DRAFT-first lifecycle a real `POST .../activate` call goes through),
 *  same "seed the end state directly" convention as `BOBY_BITES_PRODUCTS` seeding
 *  `ACTIVE` instead of `DRAFT`. */
const PLANTAIN_CHIPS_BOM = {
  bomNumber: 'BOM-000001',
  productCode: 'PRD-000001',
  name: 'Plantain Chips v1',
  yieldQuantity: 1000,
  items: [
    { productCode: 'PRD-000011', quantity: 500, unitOfMeasure: 'Kilogram' },
    { productCode: 'PRD-000012', quantity: 50, unitOfMeasure: 'Litre' },
    { productCode: 'PRD-000009', quantity: 5, unitOfMeasure: 'Kilogram' },
    { productCode: 'PRD-000013', quantity: 1000, unitOfMeasure: 'Roll' },
  ],
} as const;

/** `PROD-000001` plans 500 of the BOM's 1000-pack yield — exactly half — so its
 *  requirement snapshot below is every component quantity halved, the same scaling
 *  `ProductionOrderService.create` performs at request time. Seeded `PLANNED` (past
 *  `DRAFT`, not yet `IN_PROGRESS`) so the live Boby Bites verification scenario (brief
 *  §27) can exercise Material Issue immediately without an extra manual "plan" step. */
const PLANTAIN_CHIPS_PRODUCTION_ORDER_NUMBER = 'PROD-000001';
const PLANTAIN_CHIPS_PLANNED_QUANTITY = 500;

async function seedProduction(
  organisationId: string,
  actorUserId: string,
  productsByCode: Record<string, string>,
  locationId: string,
): Promise<void> {
  console.log('Seeding Production (1 active Plantain Chips BOM + 1 Production Order)...');

  const finishedProductId = productsByCode[PLANTAIN_CHIPS_BOM.productCode]!;
  const existingBom = await prisma.billOfMaterial.findUnique({
    where: { bomNumber: PLANTAIN_CHIPS_BOM.bomNumber },
  });
  const bom =
    existingBom ??
    (await prisma.billOfMaterial.create({
      data: {
        organisationId,
        bomNumber: PLANTAIN_CHIPS_BOM.bomNumber,
        productId: finishedProductId,
        name: PLANTAIN_CHIPS_BOM.name,
        status: 'ACTIVE',
        yieldQuantity: PLANTAIN_CHIPS_BOM.yieldQuantity,
        createdById: actorUserId,
        updatedById: actorUserId,
        items: {
          create: PLANTAIN_CHIPS_BOM.items.map((item) => ({
            componentProductId: productsByCode[item.productCode]!,
            quantity: item.quantity,
            unitOfMeasure: item.unitOfMeasure,
          })),
        },
      },
    }));

  const existingOrder = await prisma.productionOrder.findUnique({
    where: { productionOrderNumber: PLANTAIN_CHIPS_PRODUCTION_ORDER_NUMBER },
  });
  if (existingOrder) {
    return;
  }

  await prisma.productionOrder.create({
    data: {
      organisationId,
      productionOrderNumber: PLANTAIN_CHIPS_PRODUCTION_ORDER_NUMBER,
      productId: finishedProductId,
      billOfMaterialId: bom.id,
      plannedQuantity: PLANTAIN_CHIPS_PLANNED_QUANTITY,
      locationId,
      status: 'PLANNED',
      notes: 'First production run of Plantain Chips for the new Production module.',
      createdById: actorUserId,
      updatedById: actorUserId,
      items: {
        create: PLANTAIN_CHIPS_BOM.items.map((item) => ({
          componentProductId: productsByCode[item.productCode]!,
          requiredQuantity:
            (item.quantity * PLANTAIN_CHIPS_PLANNED_QUANTITY) / PLANTAIN_CHIPS_BOM.yieldQuantity,
          unitOfMeasure: item.unitOfMeasure,
        })),
      },
    },
  });
}

/** One `ProductFamily` ("Plantain Chips") with three `ProductVariant`s, each carrying
 *  three pack-size SKUs — the exact worked example from the Sprint 4.7 brief. The
 *  pre-existing `PRD-000001` "Plantain Chips" (with its own `BOM-000001`/`PROD-000001`
 *  chain, Sprint 4.6) is deliberately left completely untouched — `productVariantId`
 *  stays `null` on that row, proving a pre-existing product needs no migration to keep
 *  working.
 *
 *  `code`/`bomNumber`/`productionOrderNumber` are all GLOBALLY unique (not per
 *  organisation — see `Product.code`'s own schema comment), so a code that looks free
 *  against `BOBY_BITES_PRODUCTS` can still collide with a row some *other* organisation
 *  created via live browser/API testing in an earlier sprint (this dev database is
 *  shared across every organisation ever registered against it, same situation
 *  `BOBY_BITES_PRODUCTS`'s own "why -000006–-000008 are skipped" comment describes).
 *  `PRD-000020` was tried first and found to collide with exactly this kind of
 *  organically-created row from another organisation — `PRD-000030` replaced it. */
const PLANTAIN_CHIPS_FAMILY = {
  code: 'FAM-000001',
  name: 'Plantain Chips',
} as const;

const PLANTAIN_CHIPS_VARIANTS = [
  {
    code: 'VAR-000001',
    name: 'Sweet & Spicy — Ripe Plantain',
    skus: [
      { code: 'PRD-000030', name: 'Plantain Chips Sweet & Spicy 30g', unit: 'Pack' },
      { code: 'PRD-000021', name: 'Plantain Chips Sweet & Spicy 500g', unit: 'Pack' },
      { code: 'PRD-000022', name: 'Plantain Chips Sweet & Spicy 1kg', unit: 'Pack' },
    ],
  },
  {
    code: 'VAR-000002',
    name: 'Green & Spicy — Unripe Plantain',
    skus: [
      { code: 'PRD-000023', name: 'Plantain Chips Green & Spicy 30g', unit: 'Pack' },
      { code: 'PRD-000024', name: 'Plantain Chips Green & Spicy 500g', unit: 'Pack' },
      { code: 'PRD-000025', name: 'Plantain Chips Green & Spicy 1kg', unit: 'Pack' },
    ],
  },
  {
    code: 'VAR-000003',
    name: 'Classic Salted',
    skus: [
      { code: 'PRD-000026', name: 'Plantain Chips Classic Salted 30g', unit: 'Pack' },
      { code: 'PRD-000027', name: 'Plantain Chips Classic Salted 500g', unit: 'Pack' },
      { code: 'PRD-000028', name: 'Plantain Chips Classic Salted 1kg', unit: 'Pack' },
    ],
  },
] as const;

/** Returns a `code -> id` map (SKUs only) so `seedProductFamilyProduction` and the final
 *  summary can reference the newly-seeded products without a second round-trip lookup —
 *  same convention as `seedProducts`'s own return value. Idempotent: every row is
 *  `upsert`ed by its own unique `code`, exactly like `seedProducts`/`seedSuppliers`. */
async function seedProductFamilyHierarchy(
  organisationId: string,
  actorUserId: string,
): Promise<Record<string, string>> {
  console.log('Seeding Product Family hierarchy (1 family, 3 variants, 9 SKUs)...');

  const family = await prisma.productFamily.upsert({
    where: { code: PLANTAIN_CHIPS_FAMILY.code },
    update: {},
    create: {
      organisationId,
      code: PLANTAIN_CHIPS_FAMILY.code,
      name: PLANTAIN_CHIPS_FAMILY.name,
      status: 'ACTIVE',
      createdById: actorUserId,
      updatedById: actorUserId,
    },
  });

  const skusByCode: Record<string, string> = {};
  for (const variantData of PLANTAIN_CHIPS_VARIANTS) {
    const variant = await prisma.productVariant.upsert({
      where: { code: variantData.code },
      update: {},
      create: {
        organisationId,
        productFamilyId: family.id,
        code: variantData.code,
        name: variantData.name,
        status: 'ACTIVE',
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    });

    for (const sku of variantData.skus) {
      const created = await prisma.product.upsert({
        where: { code: sku.code },
        update: {},
        create: {
          organisationId,
          code: sku.code,
          name: sku.name,
          slug: slugifyForSeed(sku.name),
          category: 'SNACKS',
          type: 'FINISHED_PRODUCT',
          unit: sku.unit,
          status: 'ACTIVE',
          productVariantId: variant.id,
          createdById: actorUserId,
          updatedById: actorUserId,
        },
      });
      skusByCode[sku.code] = created.id;
    }
  }

  return skusByCode;
}

/** Same slugify shape as `ProductService`'s own (lowercase, non-alnum -> `-`, trimmed) —
 *  kept local since the seed script runs outside the NestJS DI container and has no
 *  access to `ProductService.generateUniqueSlug`'s collision-avoidance loop; these nine
 *  names are known upfront to be unique within the organisation. */
function slugifyForSeed(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** One BOM + Production Order against a new hierarchy SKU (Sprint 4.7 brief §16: "not
 *  every SKU needs a complete production BOM... at least enough to prove Family ->
 *  Variant -> SKU -> BOM -> Production Order"). Deliberately a separate function from
 *  `seedProduction` — the pre-existing `BOM-000001`/`PROD-000001` chain (Sprint 4.6) is
 *  never touched by this sprint. Reuses the same four raw materials/packaging
 *  `PLANTAIN_CHIPS_BOM` already reuses, at pack-appropriate quantities for the smaller
 *  30g SKU. */
const SWEET_SPICY_30G_BOM = {
  bomNumber: 'BOM-000003',
  productCode: 'PRD-000030',
  name: 'Plantain Chips Sweet & Spicy 30g v1',
  yieldQuantity: 2000,
  items: [
    { productCode: 'PRD-000011', quantity: 40, unitOfMeasure: 'Kilogram' },
    { productCode: 'PRD-000012', quantity: 4, unitOfMeasure: 'Litre' },
    { productCode: 'PRD-000009', quantity: 0.4, unitOfMeasure: 'Kilogram' },
    { productCode: 'PRD-000013', quantity: 2000, unitOfMeasure: 'Roll' },
  ],
} as const;
const SWEET_SPICY_30G_PRODUCTION_ORDER_NUMBER = 'PROD-000003';
const SWEET_SPICY_30G_PLANNED_QUANTITY = 1000;

async function seedProductFamilyProduction(
  organisationId: string,
  actorUserId: string,
  productsByCode: Record<string, string>,
  locationId: string,
): Promise<void> {
  console.log(
    'Seeding Production for the Product Family hierarchy (1 BOM + 1 Production Order)...',
  );

  const finishedProductId = productsByCode[SWEET_SPICY_30G_BOM.productCode]!;
  const existingBom = await prisma.billOfMaterial.findUnique({
    where: { bomNumber: SWEET_SPICY_30G_BOM.bomNumber },
  });
  const bom =
    existingBom ??
    (await prisma.billOfMaterial.create({
      data: {
        organisationId,
        bomNumber: SWEET_SPICY_30G_BOM.bomNumber,
        productId: finishedProductId,
        name: SWEET_SPICY_30G_BOM.name,
        status: 'ACTIVE',
        yieldQuantity: SWEET_SPICY_30G_BOM.yieldQuantity,
        createdById: actorUserId,
        updatedById: actorUserId,
        items: {
          create: SWEET_SPICY_30G_BOM.items.map((item) => ({
            componentProductId: productsByCode[item.productCode]!,
            quantity: item.quantity,
            unitOfMeasure: item.unitOfMeasure,
          })),
        },
      },
    }));

  const existingOrder = await prisma.productionOrder.findUnique({
    where: { productionOrderNumber: SWEET_SPICY_30G_PRODUCTION_ORDER_NUMBER },
  });
  if (existingOrder) {
    return;
  }

  await prisma.productionOrder.create({
    data: {
      organisationId,
      productionOrderNumber: SWEET_SPICY_30G_PRODUCTION_ORDER_NUMBER,
      productId: finishedProductId,
      billOfMaterialId: bom.id,
      plannedQuantity: SWEET_SPICY_30G_PLANNED_QUANTITY,
      locationId,
      status: 'PLANNED',
      notes: 'First production run of the Sweet & Spicy 30g SKU (Product Family hierarchy demo).',
      createdById: actorUserId,
      updatedById: actorUserId,
      items: {
        create: SWEET_SPICY_30G_BOM.items.map((item) => ({
          componentProductId: productsByCode[item.productCode]!,
          requiredQuantity:
            (item.quantity * SWEET_SPICY_30G_PLANNED_QUANTITY) / SWEET_SPICY_30G_BOM.yieldQuantity,
          unitOfMeasure: item.unitOfMeasure,
        })),
      },
    },
  });
}

// ============================================================================
// Sprint 4.8 — Customer, Territory, Outlet, Retail Network & Sales Foundation
// (docs/domains/customers.md, outlets.md, territories.md, retail-network.md, sales.md)
// ============================================================================

/** Oyo State -> Ibadan -> {Ibadan North, Ibadan South-West} -> areas. `parentCode` is
 *  resolved against the map this same function builds up as it goes (parents always
 *  appear before their children in this array), same "sequential, self-referencing
 *  build order" convention used nowhere else yet in this file since Territory is the
 *  first self-referential seed entity. */
const BOBY_BITES_TERRITORIES = [
  { code: 'TER-000001', name: 'Oyo State', type: 'State', parentCode: null },
  { code: 'TER-000002', name: 'Ibadan', type: 'City', parentCode: 'TER-000001' },
  { code: 'TER-000003', name: 'Ibadan North', type: 'LGA', parentCode: 'TER-000002' },
  { code: 'TER-000004', name: 'Ibadan South-West', type: 'LGA', parentCode: 'TER-000002' },
  { code: 'TER-000005', name: 'Bodija', type: 'Area', parentCode: 'TER-000003' },
  { code: 'TER-000006', name: 'Mokola', type: 'Area', parentCode: 'TER-000003' },
  { code: 'TER-000007', name: 'Challenge', type: 'Area', parentCode: 'TER-000004' },
] as const;

/** Returns a `code -> id` map so `seedCustomers`/`seedOutlets` can reference the
 *  newly-seeded territories without a second round-trip lookup — same convention as
 *  `seedProducts`'s own return value. Idempotent: every row is `upsert`ed by its own
 *  unique `territoryCode`. */
async function seedTerritories(
  organisationId: string,
  actorUserId: string,
): Promise<Record<string, string>> {
  console.log('Seeding Territories (Oyo State hierarchy)...');

  const territoriesByCode: Record<string, string> = {};
  for (const territory of BOBY_BITES_TERRITORIES) {
    const row = await prisma.territory.upsert({
      where: { territoryCode: territory.code },
      update: {},
      create: {
        organisationId,
        territoryCode: territory.code,
        name: territory.name,
        type: territory.type,
        status: 'ACTIVE',
        createdById: actorUserId,
        updatedById: actorUserId,
        ...(territory.parentCode
          ? { parentTerritoryId: territoriesByCode[territory.parentCode] }
          : {}),
      },
    });
    territoriesByCode[territory.code] = row.id;
  }
  return territoriesByCode;
}

/**
 * Nine customers spanning every `CustomerType`, deliberately demonstrating the sprint's
 * core principle: `territoryCode` is present on most but absent on some (territory
 * assignment is always optional), and — critically — `networked` marks only 4 of the 9
 * as ever appearing in a `DistributionNetworkRelationship` (seeded below in
 * `seedNetworkRelationships`). The other 5, including a supermarket, a retailer, a
 * corporate account, a hotel, and a retailer onboarded with nothing but a name/type/
 * phone, all buy directly from Boby Bites with zero network mapping — proving direct
 * sales work completely independently of the distribution network (brief §33: "Do NOT
 * make every customer part of a network").
 */
const BOBY_BITES_CUSTOMERS = [
  {
    code: 'CUS-000001',
    customerType: 'DISTRIBUTOR',
    customerName: 'Adeyemi Distribution Ltd',
    contactPersonName: 'Tunde Adeyemi',
    phoneNumber: '+2348021110001',
    territoryCode: 'TER-000003',
  },
  {
    code: 'CUS-000002',
    customerType: 'WHOLESALER',
    customerName: 'Bodija Wholesale Hub',
    contactPersonName: 'Kemi Okonkwo',
    phoneNumber: '+2348021110002',
    territoryCode: 'TER-000005',
  },
  {
    code: 'CUS-000003',
    customerType: 'SUPERMARKET',
    customerName: 'Bodija Supermart',
    contactPersonName: 'Ngozi Eze',
    phoneNumber: '+2348021110003',
    territoryCode: 'TER-000005',
  },
  {
    code: 'CUS-000004',
    customerType: 'RETAILER',
    customerName: 'Mama Ngozi Provisions',
    contactPersonName: 'Ngozi Chukwu',
    phoneNumber: '+2348021110004',
    territoryCode: 'TER-000006',
  },
  {
    code: 'CUS-000005',
    customerType: 'RETAILER',
    customerName: 'Challenge Corner Shop',
    contactPersonName: 'Musa Bello',
    phoneNumber: '+2348021110005',
    territoryCode: 'TER-000007',
  },
  {
    code: 'CUS-000006',
    customerType: 'CORPORATE',
    customerName: 'Oyo Foods Corporate Services',
    contactPersonName: 'Funke Bakare',
    phoneNumber: '+2348021110006',
    territoryCode: 'TER-000002',
  },
  {
    code: 'CUS-000007',
    customerType: 'RESTAURANT',
    customerName: 'Amala Spot Restaurant',
    contactPersonName: 'Chidi Okafor',
    phoneNumber: '+2348021110007',
    territoryCode: 'TER-000004',
  },
  {
    code: 'CUS-000008',
    customerType: 'HOTEL',
    customerName: 'Premier Hotel Ibadan',
    contactPersonName: 'Grace Adeleke',
    phoneNumber: '+2348021110008',
    territoryCode: 'TER-000006',
  },
  {
    // Minimum-onboarding proof: no territory, no contact person — just what a field
    // agent could capture in under two minutes (brief §7).
    code: 'CUS-000009',
    customerType: 'RETAILER',
    customerName: 'Ibadan North Trading Stores',
    contactPersonName: null,
    phoneNumber: '+2348021110009',
    territoryCode: null,
  },
  {
    // Sprint 5's end-to-end Dispatch/Delivery fixture (brief §29) — deliberately
    // un-networked at seed time; `seedNetworkRelationships` never touches this customer,
    // proving a Distributor relationship can be added for her later with zero effect on
    // any historical order/fulfilment/dispatch/delivery. `CUS-000012` (not `-000010`)
    // because `-000010`/`-000011` were already claimed by earlier manual live-testing
    // fixtures in this shared dev database before this sprint began.
    code: 'CUS-000012',
    customerType: 'RETAILER',
    customerName: 'Mama Nkechi Stores',
    contactPersonName: 'Nkechi Obi',
    phoneNumber: '+2348021110010',
    territoryCode: 'TER-000003', // Ibadan North — deliberately less specific than her outlet's
  },
] as const;

/** Returns a `code -> id` map. Idempotent: every row is `upsert`ed by its own unique
 *  `customerCode`. */
async function seedCustomers(
  organisationId: string,
  actorUserId: string,
  territoriesByCode: Record<string, string>,
): Promise<Record<string, string>> {
  console.log('Seeding Customers (10 Boby Bites customers, 6 deliberately un-networked)...');

  const customersByCode: Record<string, string> = {};
  for (const customer of BOBY_BITES_CUSTOMERS) {
    const row = await prisma.customer.upsert({
      where: { customerCode: customer.code },
      update: {},
      create: {
        organisationId,
        customerCode: customer.code,
        customerType: customer.customerType,
        customerName: customer.customerName,
        contactPersonName: customer.contactPersonName,
        phoneNumber: customer.phoneNumber,
        status: 'ACTIVE',
        createdById: actorUserId,
        updatedById: actorUserId,
        ...(customer.territoryCode
          ? { territoryId: territoriesByCode[customer.territoryCode] }
          : {}),
      },
    });
    customersByCode[customer.code] = row.id;
  }
  return customersByCode;
}

const BOBY_BITES_OUTLETS = [
  {
    code: 'OUT-000001',
    customerCode: 'CUS-000001',
    outletType: 'DISTRIBUTOR_WAREHOUSE',
    name: 'Adeyemi Central Warehouse',
    territoryCode: 'TER-000003',
    latitude: 7.4106,
    longitude: 3.9187,
  },
  {
    code: 'OUT-000002',
    customerCode: 'CUS-000002',
    outletType: 'WHOLESALER_WAREHOUSE',
    name: 'Bodija Wholesale Depot',
    territoryCode: 'TER-000005',
    latitude: null,
    longitude: null,
  },
  {
    code: 'OUT-000003',
    customerCode: 'CUS-000003',
    outletType: 'SUPERMARKET',
    name: 'Bodija Supermart — Bodija Branch',
    territoryCode: 'TER-000005',
    latitude: 7.4306,
    longitude: 3.9017,
  },
  {
    code: 'OUT-000004',
    customerCode: 'CUS-000004',
    outletType: 'RETAIL_SHOP',
    name: 'Mama Ngozi Provisions Shop',
    territoryCode: 'TER-000006',
    latitude: null,
    longitude: null,
  },
  {
    code: 'OUT-000005',
    customerCode: 'CUS-000005',
    outletType: 'MARKET_STALL',
    name: 'Bodija Market Stall B12',
    territoryCode: 'TER-000007',
    latitude: 7.4291,
    longitude: 3.9042,
  },
  {
    code: 'OUT-000006',
    customerCode: 'CUS-000007',
    outletType: 'RESTAURANT',
    name: 'Amala Spot — Ring Road',
    territoryCode: 'TER-000004',
    latitude: null,
    longitude: null,
  },
  {
    code: 'OUT-000007',
    customerCode: 'CUS-000008',
    outletType: 'HOTEL',
    name: 'Premier Hotel Ibadan',
    territoryCode: 'TER-000006',
    latitude: 7.4188,
    longitude: 3.8964,
  },
  {
    // Deliberately more specific than CUS-000012's own `TER-000003` (Ibadan North) — this
    // is the fixture that exercises Distribution's "outlet's territory takes precedence
    // over the customer's" display rule live. `OUT-000009` (not `-000008`) because
    // `-000008` was already claimed by an earlier manual live-testing fixture in this
    // shared dev database before this sprint began.
    code: 'OUT-000009',
    customerCode: 'CUS-000012',
    outletType: 'RETAIL_SHOP',
    name: 'Mama Nkechi Stores – Bodija',
    territoryCode: 'TER-000005',
    latitude: null,
    longitude: null,
  },
] as const;

/** Returns a `code -> id` map. Idempotent: every row is `upsert`ed by its own unique
 *  `outletCode`. No photos are seeded here — binary fixtures aren't idempotent and would
 *  pollute the local uploads directory on every re-run; outlet photography is exercised
 *  live during verification instead (docs/sprint-4.8-completion-report.md). */
async function seedOutlets(
  organisationId: string,
  actorUserId: string,
  customersByCode: Record<string, string>,
  territoriesByCode: Record<string, string>,
): Promise<Record<string, string>> {
  console.log('Seeding Outlets (8 Boby Bites outlets)...');

  const outletsByCode: Record<string, string> = {};
  for (const outlet of BOBY_BITES_OUTLETS) {
    const row = await prisma.outlet.upsert({
      where: { outletCode: outlet.code },
      update: {},
      create: {
        organisationId,
        customerId: customersByCode[outlet.customerCode]!,
        outletCode: outlet.code,
        outletType: outlet.outletType,
        name: outlet.name,
        latitude: outlet.latitude,
        longitude: outlet.longitude,
        status: 'ACTIVE',
        createdById: actorUserId,
        updatedById: actorUserId,
        ...(outlet.territoryCode ? { territoryId: territoriesByCode[outlet.territoryCode] } : {}),
      },
    });
    outletsByCode[outlet.code] = row.id;
  }
  return outletsByCode;
}

/**
 * Only 3 relationships across 9 customers — deliberately not a fully-mapped network
 * (brief §33). Demonstrates every kind of link the model supports (distributor ->
 * wholesaler, distributor -> a direct restaurant customer, wholesaler -> retailer)
 * while leaving Bodija Supermart, Challenge Corner Shop, Oyo Foods Corporate, Premier
 * Hotel, and Ibadan North Trading Stores completely un-networked.
 */
const BOBY_BITES_NETWORK_RELATIONSHIPS = [
  {
    sourceCode: 'CUS-000001', // Adeyemi Distribution Ltd
    targetCode: 'CUS-000002', // Bodija Wholesale Hub
    relationshipType: 'DISTRIBUTES_TO',
  },
  {
    sourceCode: 'CUS-000001', // Adeyemi Distribution Ltd
    targetCode: 'CUS-000007', // Amala Spot Restaurant
    relationshipType: 'SUPPLIES',
  },
  {
    sourceCode: 'CUS-000002', // Bodija Wholesale Hub
    targetCode: 'CUS-000004', // Mama Ngozi Provisions
    relationshipType: 'WHOLESALES_TO',
  },
] as const;

/** No natural unique key on this tuple by design (see the model's schema comment on why
 *  there's no `@@unique`) — idempotency here is `findFirst`-then-conditional-create,
 *  same pattern as `seedInventoryLocations`. */
async function seedNetworkRelationships(
  organisationId: string,
  actorUserId: string,
  customersByCode: Record<string, string>,
): Promise<void> {
  console.log('Seeding Distribution Network Relationships (3 of 9 customers networked)...');

  for (const relationship of BOBY_BITES_NETWORK_RELATIONSHIPS) {
    const sourceCustomerId = customersByCode[relationship.sourceCode]!;
    const targetCustomerId = customersByCode[relationship.targetCode]!;
    const existing = await prisma.distributionNetworkRelationship.findFirst({
      where: {
        organisationId,
        sourceCustomerId,
        targetCustomerId,
        relationshipType: relationship.relationshipType,
      },
    });
    if (existing) {
      continue;
    }
    await prisma.distributionNetworkRelationship.create({
      data: {
        organisationId,
        sourceCustomerId,
        targetCustomerId,
        relationshipType: relationship.relationshipType,
        effectiveFrom: new Date(),
        status: 'ACTIVE',
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    });
  }
}

/**
 * Seven sales orders demonstrating: an un-networked supermarket buying direct
 * (`SO-000001`), an un-networked retailer buying direct (`SO-000002`), a distributor's
 * own bulk direct order (`SO-000003`), a *networked* retailer still buying direct —
 * proving the network relationship above never routes or restricts anything
 * (`SO-000004`), an order with no outlet at all (`SO-000005`), a fresh `CONFIRMED`
 * order with no fulfilment yet (`SO-000008`), and an order that ends up fully
 * `FULFILLED` (`SO-000009`) — the latter two support Sprint 4.9's
 * `seedSalesFulfilments` below. Totals are pre-computed literally here since this script
 * writes Prisma directly, bypassing `SalesOrderService`'s own server-side calculation.
 * `status` here is each order's state as first created — `seedSalesFulfilments` mutates
 * `SO-000001`/`SO-000009` onward to `PARTIALLY_FULFILLED`/`FULFILLED` afterward.
 */
const BOBY_BITES_SALES_ORDERS = [
  {
    orderCode: 'SO-000001',
    customerCode: 'CUS-000003', // Bodija Supermart — un-networked
    outletCode: 'OUT-000003',
    status: 'CONFIRMED',
    items: [
      { productCode: 'PRD-000030', quantity: 200, unitPrice: 250 },
      { productCode: 'PRD-000027', quantity: 50, unitPrice: 3200 },
    ],
  },
  {
    orderCode: 'SO-000002',
    customerCode: 'CUS-000005', // Challenge Corner Shop — un-networked
    outletCode: 'OUT-000005',
    status: 'CONFIRMED',
    items: [{ productCode: 'PRD-000030', quantity: 40, unitPrice: 260 }],
  },
  {
    orderCode: 'SO-000003',
    customerCode: 'CUS-000001', // Adeyemi Distribution Ltd — buys directly too
    outletCode: 'OUT-000001',
    status: 'CONFIRMED',
    items: [{ productCode: 'PRD-000022', quantity: 500, unitPrice: 5800 }],
  },
  {
    orderCode: 'SO-000004',
    customerCode: 'CUS-000004', // Mama Ngozi Provisions — networked, still buys direct
    outletCode: 'OUT-000004',
    status: 'DRAFT',
    items: [{ productCode: 'PRD-000026', quantity: 30, unitPrice: 270 }],
  },
  {
    orderCode: 'SO-000005',
    customerCode: 'CUS-000006', // Oyo Foods Corporate — no outlet at all
    outletCode: null,
    status: 'CONFIRMED',
    items: [{ productCode: 'PRD-000021', quantity: 100, unitPrice: 3100 }],
  },
  {
    orderCode: 'SO-000008',
    customerCode: 'CUS-000002', // Bodija Wholesale Hub — confirmed, ready to fulfil
    outletCode: 'OUT-000002',
    status: 'CONFIRMED',
    items: [{ productCode: 'PRD-000030', quantity: 60, unitPrice: 250 }],
  },
  {
    orderCode: 'SO-000009',
    customerCode: 'CUS-000007', // Amala Spot Restaurant — fully fulfilled in one batch
    outletCode: 'OUT-000006',
    status: 'CONFIRMED',
    items: [{ productCode: 'PRD-000027', quantity: 20, unitPrice: 3200 }],
  },
  {
    // Sprint 5's end-to-end fixture: fulfilled in full below, then dispatched and
    // partially delivered by `seedDispatchesAndDeliveries`.
    orderCode: 'SO-000011',
    customerCode: 'CUS-000012', // Mama Nkechi Stores — un-networked
    outletCode: 'OUT-000009',
    status: 'CONFIRMED',
    items: [{ productCode: 'PRD-000027', quantity: 500, unitPrice: 3200 }],
  },
] as const;

/**
 * Tops up finished-goods stock for the two SKUs the seeded Sales Orders above actually
 * sell (`PRD-000030`/`PRD-000027`), so `seedSalesFulfilments` below — and a live
 * "fulfil this order" walkthrough — has real stock to deduct from without going
 * negative. Neither SKU carries any stock from Goods Receiving/Production seed data
 * (Sprint 4.9). Recorded as an `ADJUSTMENT`/`FOUND_STOCK` transaction, never written
 * straight to `InventoryStock` — same rule `seedProductionRawMaterialTopUp` follows, and
 * idempotent the same way (a `referenceType: 'SalesSeedTopUp'` existence check per
 * product).
 */
const SALES_FULFILMENT_STOCK_TOPUPS = [
  { productCode: 'PRD-000030', quantity: 250 },
  // Bumped from 100 (Sprint 4.9) to comfortably cover Sprint 5's additional 500-unit
  // SO-000010 fulfilment on top of the existing 70-unit draw from SO-000001/SO-000009.
  { productCode: 'PRD-000027', quantity: 700 },
] as const;

async function seedSalesFulfilmentStockTopUp(
  organisationId: string,
  actorUserId: string,
  productsByCode: Record<string, string>,
  locationId: string,
): Promise<void> {
  console.log('Topping up finished-goods stock for Sales Fulfilment testing...');
  for (const topUp of SALES_FULFILMENT_STOCK_TOPUPS) {
    const productId = productsByCode[topUp.productCode]!;
    const existing = await prisma.inventoryTransaction.findFirst({
      where: { organisationId, productId, locationId, referenceType: 'SalesSeedTopUp' },
    });
    if (existing) {
      continue;
    }

    const stock = await prisma.inventoryStock.findUnique({
      where: { organisationId_productId_locationId: { organisationId, productId, locationId } },
    });
    const newQuantity = (stock?.quantityOnHand ?? 0) + topUp.quantity;

    await prisma.$transaction([
      prisma.inventoryStock.upsert({
        where: { organisationId_productId_locationId: { organisationId, productId, locationId } },
        create: { organisationId, productId, locationId, quantityOnHand: newQuantity },
        update: { quantityOnHand: newQuantity },
      }),
      prisma.inventoryTransaction.create({
        data: {
          organisationId,
          productId,
          locationId,
          transactionType: 'ADJUSTMENT',
          quantity: topUp.quantity,
          referenceType: 'SalesSeedTopUp',
          adjustmentReason: 'FOUND_STOCK',
          notes: 'Sprint 4.9 seed — finished-goods top-up for Sales Fulfilment testing.',
          createdById: actorUserId,
        },
      }),
    ]);
  }
}

/**
 * Two fulfilment batches demonstrating the Sprint 4.9 lifecycle: `SO-000001` is
 * partially fulfilled (one line partially, one line fully — the order itself lands on
 * `PARTIALLY_FULFILLED`); `SO-000009` is fully fulfilled in a single batch (lands on
 * `FULFILLED`). `SO-000008` is deliberately left `CONFIRMED`/unfulfilled as a fresh
 * "ready to fulfil" fixture for live testing. Idempotent via each fulfilment's own
 * `idempotencyKey` — re-running seed finds the existing row and skips, never
 * double-deducting stock (the same `@@unique([salesOrderId, idempotencyKey])` guarantee
 * `SalesFulfilmentRepository.create` itself relies on).
 */
const BOBY_BITES_SALES_FULFILMENTS = [
  {
    orderCode: 'SO-000001',
    idempotencyKey: 'seed-SO-000001-1',
    items: [
      { productCode: 'PRD-000030', quantity: 120 },
      { productCode: 'PRD-000027', quantity: 50 },
    ],
  },
  {
    orderCode: 'SO-000009',
    idempotencyKey: 'seed-SO-000009-1',
    items: [{ productCode: 'PRD-000027', quantity: 20 }],
  },
  {
    // Fulfilled in full so Sprint 5's `seedDispatchesAndDeliveries` has a real
    // SalesFulfilment to dispatch from.
    orderCode: 'SO-000011',
    idempotencyKey: 'seed-SO-000011-1',
    items: [{ productCode: 'PRD-000027', quantity: 500 }],
  },
] as const;

/** Bypasses `SalesFulfilmentService`/`SalesFulfilmentRepository` and writes the same
 *  shape of data directly, same convention as every other seed helper in this file.
 *  Mirrors `SalesFulfilmentRepository.create`'s own step order (stock guard+decrement ->
 *  fulfilment+items -> paired `InventoryTransaction` rows -> item `quantityFulfilled`
 *  increment -> recomputed order status) so the seeded data is byte-consistent with what
 *  the real atomic write would have produced. */
async function seedSalesFulfilments(
  organisationId: string,
  actorUserId: string,
  salesOrdersByCode: Record<string, { id: string }>,
  productsByCode: Record<string, string>,
  locationId: string,
): Promise<void> {
  console.log('Seeding Sales Fulfilments (partial + full)...');

  for (const fulfilment of BOBY_BITES_SALES_FULFILMENTS) {
    const salesOrderId = salesOrdersByCode[fulfilment.orderCode]!.id;
    const existing = await prisma.salesFulfilment.findFirst({
      where: { organisationId, salesOrderId, idempotencyKey: fulfilment.idempotencyKey },
    });
    if (existing) {
      continue;
    }

    await prisma.$transaction(async (tx) => {
      for (const item of fulfilment.items) {
        const productId = productsByCode[item.productCode]!;
        const stock = await tx.inventoryStock.findUnique({
          where: { organisationId_productId_locationId: { organisationId, productId, locationId } },
        });
        const newQuantity = (stock?.quantityOnHand ?? 0) - item.quantity;
        await tx.inventoryStock.upsert({
          where: { organisationId_productId_locationId: { organisationId, productId, locationId } },
          create: { organisationId, productId, locationId, quantityOnHand: newQuantity },
          update: { quantityOnHand: newQuantity },
        });
      }

      const orderItems = await tx.salesOrderItem.findMany({ where: { salesOrderId } });
      const itemIdByProduct = new Map(orderItems.map((item) => [item.productId, item.id]));

      const created = await tx.salesFulfilment.create({
        data: {
          organisationId,
          salesOrderId,
          locationId,
          fulfilmentDate: new Date(),
          fulfilledById: actorUserId,
          idempotencyKey: fulfilment.idempotencyKey,
          notes: 'Seed data — Sprint 4.9.',
          items: {
            create: fulfilment.items.map((item) => ({
              productId: productsByCode[item.productCode]!,
              salesOrderItemId: itemIdByProduct.get(productsByCode[item.productCode]!)!,
              quantityFulfilled: item.quantity,
            })),
          },
        },
      });

      await tx.inventoryTransaction.createMany({
        data: fulfilment.items.map((item) => ({
          organisationId,
          productId: productsByCode[item.productCode]!,
          locationId,
          transactionType: 'ISSUE' as const,
          quantity: item.quantity,
          referenceType: 'SalesFulfilment',
          referenceId: created.id,
        })),
      });

      for (const item of fulfilment.items) {
        await tx.salesOrderItem.update({
          where: { id: itemIdByProduct.get(productsByCode[item.productCode]!)! },
          data: { quantityFulfilled: { increment: item.quantity } },
        });
      }

      const updatedItems = await tx.salesOrderItem.findMany({ where: { salesOrderId } });
      const totalOrdered = updatedItems.reduce((sum, item) => sum + item.quantity, 0);
      const totalFulfilled = updatedItems.reduce((sum, item) => sum + item.quantityFulfilled, 0);
      const newStatus = totalFulfilled >= totalOrdered ? 'FULFILLED' : 'PARTIALLY_FULFILLED';

      await tx.salesOrder.update({
        where: { id: salesOrderId },
        data: { status: newStatus, updatedById: actorUserId },
      });
    });
  }
}

/** Idempotent: every order is `upsert`ed by its own unique `orderCode`, with items
 *  nested-created only on first insert (`update: {}` no-ops on repeated runs, same
 *  pattern every other upsert-by-code helper in this file uses). Returns an
 *  `orderCode -> id` map so `seedSalesFulfilments` can reference the real rows. */
async function seedSalesOrders(
  organisationId: string,
  actorUserId: string,
  customersByCode: Record<string, string>,
  outletsByCode: Record<string, string>,
  productsByCode: Record<string, string>,
): Promise<Record<string, { id: string }>> {
  console.log(
    `Seeding Sales Orders (${BOBY_BITES_SALES_ORDERS.length} orders — direct sales independent of the network)...`,
  );

  const salesOrdersByCode: Record<string, { id: string }> = {};
  for (const order of BOBY_BITES_SALES_ORDERS) {
    const items = order.items.map((item) => ({
      productId: productsByCode[item.productCode]!,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.quantity * item.unitPrice,
    }));
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);

    const row = await prisma.salesOrder.upsert({
      where: { orderCode: order.orderCode },
      update: {},
      create: {
        organisationId,
        orderCode: order.orderCode,
        customerId: customersByCode[order.customerCode]!,
        salesAgentId: actorUserId,
        status: order.status,
        orderDate: new Date(),
        subtotal,
        discount: 0,
        total: subtotal,
        createdById: actorUserId,
        updatedById: actorUserId,
        items: { create: items },
        ...(order.outletCode ? { outletId: outletsByCode[order.outletCode]! } : {}),
      },
    });
    salesOrdersByCode[order.orderCode] = { id: row.id };
  }
  return salesOrdersByCode;
}

/**
 * Sprint 5's end-to-end fixture (brief §29): Plantain Chips Classic Salted 500g sold to
 * Mama Nkechi Stores — a retailer with no distributor relationship — dispatched from
 * Main Warehouse to her Bodija outlet (`DSP-000001`, 500 units), then partially
 * delivered (470 of 500, `PARTIALLY_DELIVERED`), leaving 30 units deliberately
 * outstanding as a real "still needs a delivery" fixture for live verification.
 *
 * Bypasses `DispatchService`/`DeliveryService` and writes the same shape of data
 * directly, same convention as `seedSalesFulfilments` — mirroring
 * `DispatchRepository.create`'s and `DeliveryRepository.create`'s own step order
 * (item guard+increment -> aggregate+items create -> cumulative-column increment ->
 * status recomputation) so the seeded rows are byte-consistent with what the real atomic
 * writes would have produced. Idempotent via `Dispatch.dispatchCode`'s own uniqueness.
 */
async function seedDispatchesAndDeliveries(
  organisationId: string,
  actorUserId: string,
  salesOrdersByCode: Record<string, { id: string }>,
  customersByCode: Record<string, string>,
  outletsByCode: Record<string, string>,
  productsByCode: Record<string, string>,
  locationId: string,
): Promise<void> {
  console.log('Seeding Dispatches and Deliveries (Sprint 5 — Mama Nkechi Stores)...');

  const existingDispatch = await prisma.dispatch.findUnique({
    where: { dispatchCode: 'DSP-000001' },
  });
  if (existingDispatch) {
    return;
  }

  const salesOrderId = salesOrdersByCode['SO-000011']!.id;
  const productId = productsByCode['PRD-000027']!;
  const fulfilment = await prisma.salesFulfilment.findFirstOrThrow({
    where: { organisationId, salesOrderId, idempotencyKey: 'seed-SO-000011-1' },
    include: { items: true },
  });
  const fulfilmentItem = fulfilment.items.find((item) => item.productId === productId)!;

  await prisma.$transaction(async (tx) => {
    await tx.salesFulfilmentItem.update({
      where: { id: fulfilmentItem.id },
      data: { quantityDispatched: { increment: 500 } },
    });

    const dispatch = await tx.dispatch.create({
      data: {
        organisationId,
        dispatchCode: 'DSP-000001',
        salesFulfilmentId: fulfilment.id,
        salesOrderId,
        customerId: customersByCode['CUS-000012']!,
        outletId: outletsByCode['OUT-000009']!,
        sourceLocationId: locationId,
        dispatchDate: new Date(),
        status: 'DISPATCHED',
        idempotencyKey: 'seed-DSP-000001-1',
        createdById: actorUserId,
        updatedById: actorUserId,
        items: {
          create: [
            { productId, salesFulfilmentItemId: fulfilmentItem.id, quantityDispatched: 500 },
          ],
        },
      },
      include: { items: true },
    });
    const dispatchItem = dispatch.items[0]!;

    await tx.dispatchItem.update({
      where: { id: dispatchItem.id },
      data: { quantityDelivered: { increment: 470 } },
    });

    await tx.delivery.create({
      data: {
        organisationId,
        dispatchId: dispatch.id,
        deliveryDate: new Date(),
        receivedByName: 'Nkechi Obi',
        notes: '30 units damaged in transit — packaging crushed.',
        idempotencyKey: 'seed-DELIVERY-000001-1',
        createdById: actorUserId,
        items: {
          create: [{ productId, dispatchItemId: dispatchItem.id, quantityDelivered: 470 }],
        },
      },
    });

    await tx.dispatch.update({
      where: { id: dispatch.id },
      data: { status: 'PARTIALLY_DELIVERED', updatedById: actorUserId },
    });
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
  const skusByCode = await seedProductFamilyHierarchy(organisation.id, ownerUser.id);
  Object.assign(productsByCode, skusByCode);
  const suppliersByCode = await seedSuppliers(organisation.id, ownerUser.id);
  const locationsByName = await seedInventoryLocations(organisation.id, ownerUser.id);
  const purchaseOrdersByNumber = await seedPurchaseOrders(
    organisation.id,
    ownerUser.id,
    productsByCode,
    suppliersByCode,
  );
  const mainWarehouseId = locationsByName['Main Warehouse']!;
  await seedGoodsReceipts(
    organisation.id,
    ownerUser.id,
    productsByCode,
    purchaseOrdersByNumber,
    mainWarehouseId,
  );
  await seedInventoryAdjustment(
    organisation.id,
    ownerUser.id,
    productsByCode['PRD-000009']!,
    mainWarehouseId,
  );
  await seedProductionRawMaterialTopUp(
    organisation.id,
    ownerUser.id,
    productsByCode,
    mainWarehouseId,
  );
  await seedProduction(organisation.id, ownerUser.id, productsByCode, mainWarehouseId);
  await seedProductFamilyProduction(organisation.id, ownerUser.id, productsByCode, mainWarehouseId);

  const territoriesByCode = await seedTerritories(organisation.id, ownerUser.id);
  const customersByCode = await seedCustomers(organisation.id, ownerUser.id, territoriesByCode);
  const outletsByCode = await seedOutlets(
    organisation.id,
    ownerUser.id,
    customersByCode,
    territoriesByCode,
  );
  await seedNetworkRelationships(organisation.id, ownerUser.id, customersByCode);
  const salesOrdersByCode = await seedSalesOrders(
    organisation.id,
    ownerUser.id,
    customersByCode,
    outletsByCode,
    productsByCode,
  );
  await seedSalesFulfilmentStockTopUp(
    organisation.id,
    ownerUser.id,
    productsByCode,
    mainWarehouseId,
  );
  await seedSalesFulfilments(
    organisation.id,
    ownerUser.id,
    salesOrdersByCode,
    productsByCode,
    mainWarehouseId,
  );
  await seedDispatchesAndDeliveries(
    organisation.id,
    ownerUser.id,
    salesOrdersByCode,
    customersByCode,
    outletsByCode,
    productsByCode,
    mainWarehouseId,
  );

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
    inventoryLocationsSeeded: BOBY_BITES_INVENTORY_LOCATIONS.length,
    billsOfMaterialSeeded: 2,
    productionOrdersSeeded: 2,
    productFamiliesSeeded: 1,
    productVariantsSeeded: PLANTAIN_CHIPS_VARIANTS.length,
    productFamilySkusSeeded: Object.keys(skusByCode).length,
    territoriesSeeded: BOBY_BITES_TERRITORIES.length,
    customersSeeded: BOBY_BITES_CUSTOMERS.length,
    outletsSeeded: BOBY_BITES_OUTLETS.length,
    networkRelationshipsSeeded: BOBY_BITES_NETWORK_RELATIONSHIPS.length,
    salesOrdersSeeded: BOBY_BITES_SALES_ORDERS.length,
    salesFulfilmentsSeeded: BOBY_BITES_SALES_FULFILMENTS.length,
    dispatchesSeeded: 1,
    deliveriesSeeded: 1,
    customersWithoutNetworkRelationship:
      BOBY_BITES_CUSTOMERS.length -
      new Set(BOBY_BITES_NETWORK_RELATIONSHIPS.flatMap((r) => [r.sourceCode, r.targetCode])).size,
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
