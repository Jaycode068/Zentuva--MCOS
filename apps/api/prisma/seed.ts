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
import { createHash } from 'crypto';

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
  {
    // Sprint 9 — a second, receivable Vegetable Oil order (`PO-000002` stays `DRAFT`/
    // never received, exactly as originally seeded, preserving whatever scenario that
    // was there to demonstrate). Without this, `PRD-000012` would carry a `0`
    // `averageUnitCost` at Main Warehouse — `seedProductionRawMaterialTopUp`'s own
    // top-up is a pure `ADJUSTMENT` (per docs/domains/accounting.md "Production
    // Accounting" decision #2, a manual correction never carries cost information),
    // so it cannot be the thing that gives Oil a real cost basis. This PO/its
    // matching `GRN-000009` (below) is the only legitimate source of one.
    purchaseOrderNumber: 'PO-000012',
    supplierCode: 'SUP-000002',
    orderDate: new Date('2026-08-08'),
    expectedDeliveryDate: new Date('2026-08-14'),
    status: 'PENDING',
    remarks: 'Vegetable oil for the Plantain Chips production run.',
    items: [{ productCode: 'PRD-000012', quantity: 200, unitPrice: 2000 }],
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
  {
    // Sprint 9 — gives `PRD-000012` (Vegetable Oil) a real, receipt-based
    // `averageUnitCost` before `seedProduction` issues it against `PROD-000001` —
    // see `PO-000012`'s own doc comment above for why this couldn't be the
    // Adjustment-based `seedProductionRawMaterialTopUp` instead.
    goodsReceiptNumber: 'GRN-000009',
    purchaseOrderNumber: 'PO-000012',
    receivedDate: new Date('2026-08-14'),
    remarks: 'Full delivery received in good condition.',
    items: [
      {
        productCode: 'PRD-000012',
        deliveredQuantity: 200,
        rejectedQuantity: 0,
        rejectionReason: undefined,
        rejectionNotes: undefined,
      },
    ],
  },
] as const;

/** Mirrors `GoodsReceiptRepository.receive`'s transaction (decide `PARTIALLY_RECEIVED`
 *  vs `RECEIVED`, create GoodsReceipt + items, increment `InventoryStock` by *accepted*
 *  quantity, append `InventoryTransaction` RECEIPT rows) rather than calling through the
 *  NestJS service layer — same "talks to Prisma directly" convention as the rest of
 *  this script. Idempotent on re-run: a GRN that already exists is not re-created.
 *  `GRN-000004` (the replacement for `GRN-000003`'s rejected cartons) is seeded *after*
 *  `GRN-000003` precisely so its "cumulative delivered" calculation sees the first
 *  receipt's totals — same order a real user would receive them in.
 *
 *  Sprint 8 — `payableQuantity` (accepted-vs-payable, see
 *  docs/domains/accounting.md "Accepted vs. Payable") is tracked in-memory,
 *  cumulatively, across this function's single pass over `BOBY_BITES_GOODS_RECEIPTS`
 *  in its own fixed array order — simpler than re-deriving "prior payable" from the
 *  database on every iteration (as the real `GoodsReceiptRepository.receive` must,
 *  since it can't assume request order) because this script fully controls and knows
 *  that order already. This same computation runs for **both** a fresh receipt (a
 *  brand-new database) and a receipt a pre-Sprint-8 seed run already created (an
 *  existing dev database) — for the latter, `payableQuantity` is backfilled onto the
 *  existing rows (the migration's own backfill set it equal to `acceptedQuantity`,
 *  which is *not* correct for `GRN-000005`'s excess scenario) and the Journal Entry is
 *  posted for the first time, via the same `postSeedJournalEntry` idempotency check
 *  every other call site in this script already relies on. `GRN-000005` (`PO-000011`,
 *  1,100 accepted against a 1,000-unit order) is this script's live demonstration of
 *  the split: `payableQuantity` caps at 1,000, and the excess 100 units post to
 *  `GRNI_PENDING_APPROVAL`, not `AP`. */
async function seedGoodsReceipts(
  organisationId: string,
  actorUserId: string,
  productsByCode: Record<string, string>,
  purchaseOrdersByNumber: Record<string, SeededPurchaseOrder>,
  defaultLocationId: string,
): Promise<void> {
  console.log('Seeding Inventory (5 Boby Bites goods receipts across 4 purchase orders)...');
  const cumulativePayableByPoItemId = new Map<string, number>();

  for (const grn of BOBY_BITES_GOODS_RECEIPTS) {
    const purchaseOrder = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { purchaseOrderNumber: grn.purchaseOrderNumber },
      include: { items: true },
    });
    const seededPurchaseOrder = purchaseOrdersByNumber[grn.purchaseOrderNumber]!;
    const orderedQuantityById = new Map(
      purchaseOrder.items.map((item) => [item.id, item.quantity]),
    );
    const unitPriceById = new Map(purchaseOrder.items.map((item) => [item.id, item.unitPrice]));

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

    const itemsWithPayable = items.map((item) => {
      const orderedQuantity = orderedQuantityById.get(item.purchaseOrderItemId) ?? 0;
      const priorPayable = cumulativePayableByPoItemId.get(item.purchaseOrderItemId) ?? 0;
      const remainingOrderedQuantity = Math.max(0, orderedQuantity - priorPayable);
      const payableQuantity = Math.min(item.acceptedQuantity, remainingOrderedQuantity);
      cumulativePayableByPoItemId.set(item.purchaseOrderItemId, priorPayable + payableQuantity);
      return { ...item, payableQuantity };
    });

    let goodsReceiptId: string;
    const existing = await prisma.goodsReceipt.findUnique({
      where: { goodsReceiptNumber: grn.goodsReceiptNumber },
      include: { items: true },
    });
    if (existing) {
      goodsReceiptId = existing.id;
      for (const item of itemsWithPayable) {
        const existingItem = existing.items.find(
          (row) => row.purchaseOrderItemId === item.purchaseOrderItemId,
        );
        if (existingItem && existingItem.payableQuantity !== item.payableQuantity) {
          await prisma.goodsReceiptItem.update({
            where: { id: existingItem.id },
            data: { payableQuantity: item.payableQuantity },
          });
        }
      }
    } else {
      const priorTotalsRows = await prisma.goodsReceiptItem.groupBy({
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

      const created = await prisma.$transaction(async (tx) => {
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
            idempotencyKey: `seed-${grn.goodsReceiptNumber}`,
            items: { create: itemsWithPayable },
          },
        });

        const acceptedItems = itemsWithPayable.filter((item) => item.acceptedQuantity > 0);
        for (const item of acceptedItems) {
          // Sprint 9 — mirrors `GoodsReceiptRepository.receive`'s own weighted-average
          // `averageUnitCost` computation exactly (this seed script talks to Prisma
          // directly rather than calling through the real repository, so it needs its
          // own parallel copy of this logic, same as it already does for
          // `payableQuantity` above).
          const unitPrice = unitPriceById.get(item.purchaseOrderItemId) ?? 0;
          const existingStock = await tx.inventoryStock.findUnique({
            where: {
              organisationId_productId_locationId: {
                organisationId,
                productId: item.productId,
                locationId: defaultLocationId,
              },
            },
          });
          const priorQuantity = existingStock?.quantityOnHand ?? 0;
          const priorCost = existingStock?.averageUnitCost ?? 0;
          const newQuantity = priorQuantity + item.acceptedQuantity;
          const newAverageCost =
            newQuantity > 0
              ? roundCurrencySeed(
                  (priorQuantity * priorCost + item.acceptedQuantity * unitPrice) / newQuantity,
                )
              : 0;
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
              averageUnitCost: newAverageCost,
            },
            update: { quantityOnHand: newQuantity, averageUnitCost: newAverageCost },
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

        return goodsReceipt;
      });
      goodsReceiptId = created.id;
    }

    const acceptedItems = itemsWithPayable.filter((item) => item.acceptedQuantity > 0);
    const inventoryValue = acceptedItems.reduce(
      (sum, item) =>
        sum + item.acceptedQuantity * (unitPriceById.get(item.purchaseOrderItemId) ?? 0),
      0,
    );
    const payableValue = acceptedItems.reduce(
      (sum, item) =>
        sum + item.payableQuantity * (unitPriceById.get(item.purchaseOrderItemId) ?? 0),
      0,
    );
    const excessValue = inventoryValue - payableValue;
    if (inventoryValue > 0) {
      await postSeedJournalEntry(organisationId, {
        date: grn.receivedDate,
        description: `Goods receipt ${grn.goodsReceiptNumber} — PO ${grn.purchaseOrderNumber}`,
        reference: grn.goodsReceiptNumber,
        sourceType: 'GOODS_RECEIPT',
        sourceId: goodsReceiptId,
        actorUserId,
        lines: [
          { systemKey: 'INVENTORY', debit: inventoryValue },
          ...(payableValue > 0 ? [{ systemKey: 'AP', credit: payableValue }] : []),
          ...(excessValue > 0 ? [{ systemKey: 'GRNI_PENDING_APPROVAL', credit: excessValue }] : []),
        ],
      });
    }
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
  // Bumped from 500 to 800 (Sprint 10) to comfortably cover `PROD-000001`'s existing
  // 500-roll draw plus the new `PROD-000006`'s 200-roll draw (see
  // `seedPlantain500gProduction`) with headroom left over.
  { productCode: 'PRD-000013', quantity: 800 }, // Printed Nylon
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

  const order = await prisma.productionOrder.create({
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

  // Sprint 9 — carries `PROD-000001` all the way through Material Issue and
  // Completion (previously this seed left every order at `PLANNED`), mirroring
  // `ProductionMaterialIssueRepository.issue`/`ProductionRunRepository.complete`'s own
  // transaction shape directly (same "talks to Prisma directly" convention as the rest
  // of this script), so the seeded data demonstrates a real, non-zero, multi-issue
  // WIP → Finished-Goods posting end to end. Two partial issues (60% then the
  // remaining 40% of each component's requirement) exercise the "multiple issues"
  // scenario; the completion accepts 485 of 500 produced (15 rejected) so the
  // accepted/rejected accounting split has something real to demonstrate too.
  const orderItems = await prisma.productionOrderItem.findMany({
    where: { productionOrderId: order.id },
  });
  let cumulativeWipValue = 0;

  async function seedMaterialIssue(fraction: number, issuedDate: Date): Promise<void> {
    const items = orderItems.map((item) => ({
      componentProductId: item.componentProductId,
      quantity: roundSeedQuantity(item.requiredQuantity * fraction),
    }));

    await prisma.$transaction(async (tx) => {
      await tx.productionOrder.update({
        where: { id: order.id },
        data: { status: 'IN_PROGRESS', updatedById: actorUserId },
      });

      const materialIssue = await tx.productionMaterialIssue.create({
        data: {
          organisationId,
          productionOrderId: order.id,
          issuedDate,
          issuedById: actorUserId,
          items: {
            create: items.map((item) => ({
              componentProductId: item.componentProductId,
              quantityIssued: item.quantity,
            })),
          },
        },
      });

      let issueValue = 0;
      for (const item of items) {
        const stock = await tx.inventoryStock.findUniqueOrThrow({
          where: {
            organisationId_productId_locationId: {
              organisationId,
              productId: item.componentProductId,
              locationId,
            },
          },
        });
        issueValue += item.quantity * stock.averageUnitCost;
        await tx.inventoryStock.update({
          where: {
            organisationId_productId_locationId: {
              organisationId,
              productId: item.componentProductId,
              locationId,
            },
          },
          data: { quantityOnHand: stock.quantityOnHand - item.quantity },
        });
        await tx.inventoryTransaction.create({
          data: {
            organisationId,
            productId: item.componentProductId,
            locationId,
            transactionType: 'ISSUE',
            quantity: item.quantity,
            referenceType: 'ProductionMaterialIssue',
            referenceId: materialIssue.id,
          },
        });
      }

      cumulativeWipValue += issueValue;
      await postSeedJournalEntry(organisationId, {
        date: issuedDate,
        description: `Material issue ${materialIssue.id} — Production Order ${order.productionOrderNumber}`,
        reference: order.productionOrderNumber,
        sourceType: 'PRODUCTION_MATERIAL_ISSUE',
        sourceId: materialIssue.id,
        actorUserId,
        lines: [
          { systemKey: 'WIP', debit: roundCurrencySeed(issueValue) },
          { systemKey: 'INVENTORY', credit: roundCurrencySeed(issueValue) },
        ],
      });
    });
  }

  await seedMaterialIssue(0.6, new Date('2026-08-16'));
  await seedMaterialIssue(0.4, new Date('2026-08-17'));

  const producedQuantity = 500;
  const rejectedQuantity = 15;
  const acceptedQuantity = producedQuantity - rejectedQuantity;
  const totalWipValue = roundCurrencySeed(cumulativeWipValue);
  const completedAt = new Date('2026-08-18');

  await prisma.$transaction(async (tx) => {
    await tx.productionOrder.update({
      where: { id: order.id },
      data: { status: 'COMPLETED', updatedById: actorUserId },
    });

    const productionRun = await tx.productionRun.create({
      data: {
        organisationId,
        productionOrderId: order.id,
        producedQuantity,
        rejectedQuantity,
        acceptedQuantity,
        rejectionReason: 'PACKAGING_DEFECT',
        rejectionNotes: 'Seal failure on a portion of this batch.',
        completedById: actorUserId,
        completedAt,
      },
    });

    const perUnitCost = totalWipValue / producedQuantity;
    const existingFgStock = await tx.inventoryStock.findUnique({
      where: {
        organisationId_productId_locationId: {
          organisationId,
          productId: finishedProductId,
          locationId,
        },
      },
    });
    const priorQuantity = existingFgStock?.quantityOnHand ?? 0;
    const priorCost = existingFgStock?.averageUnitCost ?? 0;
    const newQuantity = priorQuantity + acceptedQuantity;
    const newAverageCost =
      newQuantity > 0
        ? roundCurrencySeed(
            (priorQuantity * priorCost + acceptedQuantity * perUnitCost) / newQuantity,
          )
        : 0;
    await tx.inventoryStock.upsert({
      where: {
        organisationId_productId_locationId: {
          organisationId,
          productId: finishedProductId,
          locationId,
        },
      },
      create: {
        organisationId,
        productId: finishedProductId,
        locationId,
        quantityOnHand: acceptedQuantity,
        averageUnitCost: newAverageCost,
      },
      update: { quantityOnHand: newQuantity, averageUnitCost: newAverageCost },
    });
    await tx.inventoryTransaction.create({
      data: {
        organisationId,
        productId: finishedProductId,
        locationId,
        transactionType: 'RECEIPT',
        quantity: acceptedQuantity,
        referenceType: 'ProductionRun',
        referenceId: productionRun.id,
      },
    });

    const acceptedValue = roundCurrencySeed((totalWipValue * acceptedQuantity) / producedQuantity);
    const rejectedValue = roundCurrencySeed(totalWipValue - acceptedValue);
    await postSeedJournalEntry(organisationId, {
      date: completedAt,
      description: `Production completion — Production Order ${order.productionOrderNumber}`,
      reference: order.productionOrderNumber,
      sourceType: 'PRODUCTION_RUN',
      sourceId: productionRun.id,
      actorUserId,
      lines: [
        { systemKey: 'WIP', credit: totalWipValue },
        ...(acceptedValue > 0
          ? [{ systemKey: 'FINISHED_GOODS_INVENTORY', debit: acceptedValue }]
          : []),
        ...(rejectedValue > 0 ? [{ systemKey: 'PRODUCTION_LOSS', debit: rejectedValue }] : []),
      ],
    });
  });
}

/** Rounds to 6 decimal places purely to clear floating-point noise — same convention as
 *  `InventoryStockRepository.adjustStock`'s own rounding helper. */
function roundSeedQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Same 2-decimal-place money rounding convention as every other file that computes
 *  currency values in this codebase. */
function roundCurrencySeed(value: number): number {
  return Math.round(value * 100) / 100;
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

/** Sprint 10 (Sales Fulfilment → COGS Accounting Integration) — gives `PRD-000027`
 *  ("Plantain Chips Classic Salted 500g," the SKU Sales actually sells against
 *  `BOBY_BITES_SALES_ORDERS`) a real, costed Production Completion, so
 *  `InventoryStock.averageUnitCost` for it is non-zero *before*
 *  `seedSalesFulfilmentStockTopUp`'s own `ADJUSTMENT`-type top-up runs later in
 *  `main()`. Without this, every already-seeded `SalesFulfilment` would silently post
 *  no COGS journal at all (docs/domains/accounting.md "Sales Fulfilment Accounting" —
 *  the zero-cost-skip policy) — confirmed directly: `PRD-000027` carried no stock
 *  from any Goods Receiving/Production seed data before this function existed, only
 *  from `ADJUSTMENT`/`FOUND_STOCK` top-ups, which never touch `averageUnitCost` in
 *  either direction. This is the exact same class of gap Sprint 9 found and fixed for
 *  Vegetable Oil ("no legitimate cost basis"). Reuses `PLANTAIN_CHIPS_BOM`'s own four
 *  raw materials/packaging SKUs at the same ratios, planned smaller (200 packs, not
 *  500) so it doesn't contend with `PROD-000001`'s own draw against the same
 *  `PRODUCTION_RAW_MATERIAL_TOPUPS` pool (see that constant's own updated headroom
 *  comment). Unlike `PROD-000001`, this run is 100% accepted with a single Material
 *  Issue batch — a clean, easily hand-verified cost source for Sales, not another
 *  demonstration of partial issues or the accepted/rejected split (already covered by
 *  `PROD-000001`). */
const PLANTAIN_500G_BOM = {
  bomNumber: 'BOM-000004',
  productCode: 'PRD-000027',
  name: 'Plantain Chips Classic Salted 500g v1',
  yieldQuantity: 1000,
  items: [
    { productCode: 'PRD-000011', quantity: 500, unitOfMeasure: 'Kilogram' },
    { productCode: 'PRD-000012', quantity: 50, unitOfMeasure: 'Litre' },
    { productCode: 'PRD-000009', quantity: 5, unitOfMeasure: 'Kilogram' },
    { productCode: 'PRD-000013', quantity: 1000, unitOfMeasure: 'Roll' },
  ],
} as const;
// `productionOrderNumber` is globally unique (not per organisation), so a number
// that looks free against this file's own seed sequence can still collide with a row
// some other actor created via live browser/API testing against this shared dev
// database (same situation `BOBY_BITES_PRODUCTS`'s own "why -000006–-000008 are
// skipped" comment describes for `Product.code`). `PROD-000004` was tried first and
// found to already exist from earlier live-verification testing (Sprint 9);
// `PROD-000006` was confirmed free.
const PLANTAIN_500G_PRODUCTION_ORDER_NUMBER = 'PROD-000006';
const PLANTAIN_500G_PLANNED_QUANTITY = 200;

async function seedPlantain500gProduction(
  organisationId: string,
  actorUserId: string,
  productsByCode: Record<string, string>,
  locationId: string,
): Promise<void> {
  console.log(
    'Seeding Production for PRD-000027 (Sprint 10 — real cost basis for Sales Fulfilment COGS)...',
  );

  const finishedProductId = productsByCode[PLANTAIN_500G_BOM.productCode]!;
  const existingBom = await prisma.billOfMaterial.findUnique({
    where: { bomNumber: PLANTAIN_500G_BOM.bomNumber },
  });
  const bom =
    existingBom ??
    (await prisma.billOfMaterial.create({
      data: {
        organisationId,
        bomNumber: PLANTAIN_500G_BOM.bomNumber,
        productId: finishedProductId,
        name: PLANTAIN_500G_BOM.name,
        status: 'ACTIVE',
        yieldQuantity: PLANTAIN_500G_BOM.yieldQuantity,
        createdById: actorUserId,
        updatedById: actorUserId,
        items: {
          create: PLANTAIN_500G_BOM.items.map((item) => ({
            componentProductId: productsByCode[item.productCode]!,
            quantity: item.quantity,
            unitOfMeasure: item.unitOfMeasure,
          })),
        },
      },
    }));

  const existingOrder = await prisma.productionOrder.findUnique({
    where: { productionOrderNumber: PLANTAIN_500G_PRODUCTION_ORDER_NUMBER },
  });
  if (existingOrder) {
    return;
  }

  const order = await prisma.productionOrder.create({
    data: {
      organisationId,
      productionOrderNumber: PLANTAIN_500G_PRODUCTION_ORDER_NUMBER,
      productId: finishedProductId,
      billOfMaterialId: bom.id,
      plannedQuantity: PLANTAIN_500G_PLANNED_QUANTITY,
      locationId,
      status: 'PLANNED',
      notes:
        'Production run giving Plantain Chips Classic Salted 500g a real cost basis for Sales Fulfilment COGS (Sprint 10).',
      createdById: actorUserId,
      updatedById: actorUserId,
      items: {
        create: PLANTAIN_500G_BOM.items.map((item) => ({
          componentProductId: productsByCode[item.productCode]!,
          requiredQuantity:
            (item.quantity * PLANTAIN_500G_PLANNED_QUANTITY) / PLANTAIN_500G_BOM.yieldQuantity,
          unitOfMeasure: item.unitOfMeasure,
        })),
      },
    },
  });

  const orderItems = await prisma.productionOrderItem.findMany({
    where: { productionOrderId: order.id },
  });
  const issuedDate = new Date('2026-08-10');
  let totalWipValue = 0;

  await prisma.$transaction(async (tx) => {
    await tx.productionOrder.update({
      where: { id: order.id },
      data: { status: 'IN_PROGRESS', updatedById: actorUserId },
    });

    const materialIssue = await tx.productionMaterialIssue.create({
      data: {
        organisationId,
        productionOrderId: order.id,
        issuedDate,
        issuedById: actorUserId,
        items: {
          create: orderItems.map((item) => ({
            componentProductId: item.componentProductId,
            quantityIssued: item.requiredQuantity,
          })),
        },
      },
    });

    let issueValue = 0;
    for (const item of orderItems) {
      const stock = await tx.inventoryStock.findUniqueOrThrow({
        where: {
          organisationId_productId_locationId: {
            organisationId,
            productId: item.componentProductId,
            locationId,
          },
        },
      });
      issueValue += item.requiredQuantity * stock.averageUnitCost;
      await tx.inventoryStock.update({
        where: {
          organisationId_productId_locationId: {
            organisationId,
            productId: item.componentProductId,
            locationId,
          },
        },
        data: { quantityOnHand: stock.quantityOnHand - item.requiredQuantity },
      });
      await tx.inventoryTransaction.create({
        data: {
          organisationId,
          productId: item.componentProductId,
          locationId,
          transactionType: 'ISSUE',
          quantity: item.requiredQuantity,
          referenceType: 'ProductionMaterialIssue',
          referenceId: materialIssue.id,
        },
      });
    }

    totalWipValue = roundCurrencySeed(issueValue);
    await postSeedJournalEntry(organisationId, {
      date: issuedDate,
      description: `Material issue ${materialIssue.id} — Production Order ${order.productionOrderNumber}`,
      reference: order.productionOrderNumber,
      sourceType: 'PRODUCTION_MATERIAL_ISSUE',
      sourceId: materialIssue.id,
      actorUserId,
      lines: [
        { systemKey: 'WIP', debit: totalWipValue },
        { systemKey: 'INVENTORY', credit: totalWipValue },
      ],
    });
  });

  const producedQuantity = PLANTAIN_500G_PLANNED_QUANTITY;
  // 100% accepted — a clean cost source for Sales, not another accepted/rejected
  // split demonstration (PROD-000001 already covers that).
  const acceptedQuantity = producedQuantity;
  const completedAt = new Date('2026-08-11');

  await prisma.$transaction(async (tx) => {
    await tx.productionOrder.update({
      where: { id: order.id },
      data: { status: 'COMPLETED', updatedById: actorUserId },
    });

    const productionRun = await tx.productionRun.create({
      data: {
        organisationId,
        productionOrderId: order.id,
        producedQuantity,
        rejectedQuantity: 0,
        acceptedQuantity,
        completedById: actorUserId,
        completedAt,
      },
    });

    const perUnitCost = totalWipValue / producedQuantity;
    const existingFgStock = await tx.inventoryStock.findUnique({
      where: {
        organisationId_productId_locationId: {
          organisationId,
          productId: finishedProductId,
          locationId,
        },
      },
    });
    const priorQuantity = existingFgStock?.quantityOnHand ?? 0;
    const priorCost = existingFgStock?.averageUnitCost ?? 0;
    const newQuantity = priorQuantity + acceptedQuantity;
    const newAverageCost =
      newQuantity > 0
        ? roundCurrencySeed(
            (priorQuantity * priorCost + acceptedQuantity * perUnitCost) / newQuantity,
          )
        : 0;
    await tx.inventoryStock.upsert({
      where: {
        organisationId_productId_locationId: {
          organisationId,
          productId: finishedProductId,
          locationId,
        },
      },
      create: {
        organisationId,
        productId: finishedProductId,
        locationId,
        quantityOnHand: acceptedQuantity,
        averageUnitCost: newAverageCost,
      },
      update: { quantityOnHand: newQuantity, averageUnitCost: newAverageCost },
    });
    await tx.inventoryTransaction.create({
      data: {
        organisationId,
        productId: finishedProductId,
        locationId,
        transactionType: 'RECEIPT',
        quantity: acceptedQuantity,
        referenceType: 'ProductionRun',
        referenceId: productionRun.id,
      },
    });

    await postSeedJournalEntry(organisationId, {
      date: completedAt,
      description: `Production completion — Production Order ${order.productionOrderNumber}`,
      reference: order.productionOrderNumber,
      sourceType: 'PRODUCTION_RUN',
      sourceId: productionRun.id,
      actorUserId,
      lines: [
        { systemKey: 'WIP', credit: totalWipValue },
        { systemKey: 'FINISHED_GOODS_INVENTORY', debit: totalWipValue },
      ],
    });
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
  {
    // Sprint 6's end-to-end Finance fixture — the brief's own "ABC Supermarket" scenario
    // (500 packs @ ₦5,000 = ₦2,500,000). `CUS-000013` (not `-000010`/`-000011`) for the
    // same reason as `CUS-000012` above — those two codes are already claimed by earlier
    // manual live-testing fixtures in this shared dev database, verified live before
    // this sprint began.
    code: 'CUS-000013',
    customerType: 'SUPERMARKET',
    customerName: 'ABC Supermarket',
    contactPersonName: 'Chidinma Eze',
    phoneNumber: '+2348021110011',
    territoryCode: 'TER-000005',
  },
] as const;

/** Returns a `code -> id` map. Idempotent: every row is `upsert`ed by its own unique
 *  `customerCode`. */
async function seedCustomers(
  organisationId: string,
  actorUserId: string,
  territoriesByCode: Record<string, string>,
): Promise<Record<string, string>> {
  console.log('Seeding Customers (11 Boby Bites customers, 7 deliberately un-networked)...');

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
  {
    // Sprint 6's Finance fixture destination. `OUT-000010` verified free live against
    // the dev database before this sprint began (same collision-avoidance discipline as
    // `CUS-000013` above).
    code: 'OUT-000010',
    customerCode: 'CUS-000013',
    outletType: 'SUPERMARKET',
    name: 'ABC Supermarket — Bodija Branch',
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
  console.log('Seeding Outlets (9 Boby Bites outlets)...');

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
  {
    // Sprint 6's Finance fixture #1 — fulfilled in full below, then invoiced (INV-000001)
    // and paid in two installments to PAID, matching the brief's own exact arithmetic
    // (500 packs @ ₦5,000 = ₦2,500,000).
    orderCode: 'SO-000012',
    customerCode: 'CUS-000013', // ABC Supermarket
    outletCode: 'OUT-000010',
    status: 'CONFIRMED',
    items: [{ productCode: 'PRD-000027', quantity: 500, unitPrice: 5000 }],
  },
  {
    // Sprint 6's Finance fixture #2 — fulfilled in full below, then invoiced
    // (INV-000002), partially paid, then a Credit Note (CN-000001) issued for returned
    // goods, matching the brief's own second scenario exactly.
    orderCode: 'SO-000013',
    customerCode: 'CUS-000013', // ABC Supermarket
    outletCode: 'OUT-000010',
    status: 'CONFIRMED',
    items: [{ productCode: 'PRD-000027', quantity: 500, unitPrice: 5000 }],
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
 * Sprint 6's two new Finance fixture orders (`SO-000012`/`SO-000013`) each fulfil 500
 * more units of `PRD-000027` — a distinct `referenceType: 'FinanceSeedTopUp'` (not
 * `'SalesSeedTopUp'`) so this top-up is genuinely additive even against an
 * already-seeded dev database, where the old Sprint 4.9 top-up's own existence check
 * would otherwise silently no-op and leave stock 1,000 units short.
 */
const FINANCE_STOCK_TOPUPS = [{ productCode: 'PRD-000027', quantity: 1000 }] as const;

async function seedFinanceStockTopUp(
  organisationId: string,
  actorUserId: string,
  productsByCode: Record<string, string>,
  locationId: string,
): Promise<void> {
  console.log('Topping up finished-goods stock for Finance testing...');
  for (const topUp of FINANCE_STOCK_TOPUPS) {
    const productId = productsByCode[topUp.productCode]!;
    const existing = await prisma.inventoryTransaction.findFirst({
      where: { organisationId, productId, locationId, referenceType: 'FinanceSeedTopUp' },
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
          referenceType: 'FinanceSeedTopUp',
          adjustmentReason: 'FOUND_STOCK',
          notes: 'Sprint 6 seed — finished-goods top-up for Finance testing.',
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
  {
    // Fulfilled in full so Sprint 6's `seedFinance` has a real, invoiceable
    // (FULFILLED) Sales Order to invoice from.
    orderCode: 'SO-000012',
    idempotencyKey: 'seed-SO-000012-1',
    items: [{ productCode: 'PRD-000027', quantity: 500 }],
  },
  {
    orderCode: 'SO-000013',
    idempotencyKey: 'seed-SO-000013-1',
    items: [{ productCode: 'PRD-000027', quantity: 500 }],
  },
] as const;

/** Bypasses `SalesFulfilmentService`/`SalesFulfilmentRepository` and writes the same
 *  shape of data directly, same convention as every other seed helper in this file.
 *  Mirrors `SalesFulfilmentRepository.create`'s own step order (stock guard+decrement ->
 *  fulfilment+items -> paired `InventoryTransaction` rows -> item `quantityFulfilled`
 *  increment -> recomputed order status) so the seeded data is byte-consistent with what
 *  the real atomic write would have produced. Extended Sprint 10 to also compute each
 *  item's `unitCost`/`costAmount` (reading `InventoryStock.averageUnitCost` inside this
 *  same transaction, exactly as the real repository now does) and post the
 *  `DR Cost of Goods Sold / CR Finished Goods Inventory` journal via
 *  `postSeedJournalEntry` — which is itself idempotent on `(organisationId,
 *  sourceType, sourceId)`, so this only ever posts once per fulfilment regardless of
 *  how many times seed re-runs (this function's own `existing`-row check already
 *  skips already-created fulfilments entirely). */
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

    const fulfilmentDate = new Date();
    let totalCogsValue = 0;
    const itemCosts = new Map<string, { unitCost: number; costAmount: number }>();

    const created = await prisma.$transaction(async (tx) => {
      for (const item of fulfilment.items) {
        const productId = productsByCode[item.productCode]!;
        const stock = await tx.inventoryStock.findUnique({
          where: { organisationId_productId_locationId: { organisationId, productId, locationId } },
        });
        const newQuantity = (stock?.quantityOnHand ?? 0) - item.quantity;
        const unitCost = stock?.averageUnitCost ?? 0;
        const costAmount = roundCurrencySeed(item.quantity * unitCost);
        totalCogsValue = roundCurrencySeed(totalCogsValue + costAmount);
        itemCosts.set(productId, { unitCost, costAmount });
        await tx.inventoryStock.upsert({
          where: { organisationId_productId_locationId: { organisationId, productId, locationId } },
          create: { organisationId, productId, locationId, quantityOnHand: newQuantity },
          update: { quantityOnHand: newQuantity },
        });
      }

      const orderItems = await tx.salesOrderItem.findMany({ where: { salesOrderId } });
      const itemIdByProduct = new Map(orderItems.map((item) => [item.productId, item.id]));

      const createdFulfilment = await tx.salesFulfilment.create({
        data: {
          organisationId,
          salesOrderId,
          locationId,
          fulfilmentDate,
          fulfilledById: actorUserId,
          idempotencyKey: fulfilment.idempotencyKey,
          notes: 'Seed data — Sprint 4.9.',
          items: {
            create: fulfilment.items.map((item) => {
              const productId = productsByCode[item.productCode]!;
              const cost = itemCosts.get(productId)!;
              return {
                productId,
                salesOrderItemId: itemIdByProduct.get(productId)!,
                quantityFulfilled: item.quantity,
                unitCost: cost.unitCost,
                costAmount: cost.costAmount,
              };
            }),
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
          referenceId: createdFulfilment.id,
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

      return createdFulfilment;
    });

    if (totalCogsValue > 0) {
      await postSeedJournalEntry(organisationId, {
        date: fulfilmentDate,
        description: `Sales fulfilment ${created.id} — Sales Order ${fulfilment.orderCode}`,
        reference: fulfilment.orderCode,
        sourceType: 'SALES_FULFILMENT',
        sourceId: created.id,
        actorUserId,
        lines: [
          { systemKey: 'COGS', debit: totalCogsValue },
          { systemKey: 'FINISHED_GOODS_INVENTORY', credit: totalCogsValue },
        ],
      });
    }
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

/**
 * Sprint 7's Chart of Accounts (docs/domains/accounting.md) — the worked example from
 * the brief's own §30, ordered parent-before-child so a single linear pass can resolve
 * every `parentCode` against an already-created account. `systemKey` marks the eight
 * accounts Finance's automatic postings (and future Procurement/Production/Inventory
 * integrations) resolve by key rather than by hardcoded id — see
 * `SYSTEM_ACCOUNT_KEYS` in `apps/api/src/finance/accounting/chart-of-account-keys.ts`
 * (deliberately re-declared as plain string literals here, not imported — see
 * `seedFinance`'s own doc comment on why this script never imports from `src/`).
 */
const BOBY_BITES_CHART_OF_ACCOUNTS: {
  code: string;
  name: string;
  type: string;
  parentCode?: string;
  systemKey?: string;
}[] = [
  { code: '1000', name: 'Assets', type: 'ASSET' },
  { code: '1100', name: 'Cash & Bank', type: 'ASSET', parentCode: '1000' },
  { code: '1110', name: 'Cash', type: 'ASSET', parentCode: '1100', systemKey: 'CASH' },
  { code: '1120', name: 'Bank', type: 'ASSET', parentCode: '1100', systemKey: 'BANK' },
  { code: '1200', name: 'Accounts Receivable', type: 'ASSET', parentCode: '1000', systemKey: 'AR' },
  { code: '1300', name: 'Inventory', type: 'ASSET', parentCode: '1000', systemKey: 'INVENTORY' },
  { code: '1310', name: 'Raw Materials', type: 'ASSET', parentCode: '1300' },
  { code: '1320', name: 'Packaging Materials', type: 'ASSET', parentCode: '1300' },
  {
    code: '1330',
    name: 'Finished Goods',
    type: 'ASSET',
    parentCode: '1300',
    systemKey: 'FINISHED_GOODS_INVENTORY',
  },
  { code: '1340', name: 'Work In Progress', type: 'ASSET', parentCode: '1000', systemKey: 'WIP' },
  { code: '2000', name: 'Liabilities', type: 'LIABILITY' },
  {
    code: '2100',
    name: 'Accounts Payable',
    type: 'LIABILITY',
    parentCode: '2000',
    systemKey: 'AP',
  },
  {
    code: '2110',
    name: 'Goods Received – Pending Approval',
    type: 'LIABILITY',
    parentCode: '2000',
    systemKey: 'GRNI_PENDING_APPROVAL',
  },
  { code: '3000', name: 'Equity', type: 'EQUITY' },
  { code: '3100', name: "Owner's Capital", type: 'EQUITY', parentCode: '3000' },
  { code: '4000', name: 'Revenue', type: 'REVENUE' },
  {
    code: '4100',
    name: 'Product Sales',
    type: 'REVENUE',
    parentCode: '4000',
    systemKey: 'SALES_REVENUE',
  },
  {
    code: '4200',
    name: 'Sales Returns',
    type: 'REVENUE',
    parentCode: '4000',
    systemKey: 'SALES_RETURNS',
  },
  { code: '5000', name: 'Cost of Sales', type: 'COST_OF_SALES' },
  {
    code: '5100',
    name: 'Cost of Goods Sold',
    type: 'COST_OF_SALES',
    parentCode: '5000',
    systemKey: 'COGS',
  },
  { code: '6000', name: 'Expenses', type: 'EXPENSE' },
  { code: '6100', name: 'Salaries', type: 'EXPENSE', parentCode: '6000' },
  { code: '6200', name: 'Utilities', type: 'EXPENSE', parentCode: '6000' },
  { code: '6300', name: 'Rent', type: 'EXPENSE', parentCode: '6000' },
  { code: '6400', name: 'Maintenance', type: 'EXPENSE', parentCode: '6000' },
  { code: '6500', name: 'Transport', type: 'EXPENSE', parentCode: '6000' },
  {
    code: '6600',
    name: 'Production Loss / Scrap',
    type: 'EXPENSE',
    parentCode: '6000',
    systemKey: 'PRODUCTION_LOSS',
  },
];

/** Idempotency-gated on the `AR` system account already existing for this
 *  organisation. Returns nothing — every later lookup (including
 *  `postSeedJournalEntry`, below) resolves accounts by `systemKey` at the point of
 *  use, exactly like the real `journal-posting.ts`.
 *
 *  Sprint 8 adds a standalone backfill afterward (`seedGrniPendingApprovalAccount`,
 *  below) for the one new account this sprint introduces (`GRNI_PENDING_APPROVAL`) —
 *  the single early-return gate above means a dev database that already ran this
 *  function pre-Sprint-8 would otherwise never receive the new row on a re-seed. */
async function seedChartOfAccounts(organisationId: string, actorUserId: string): Promise<void> {
  console.log('Seeding Chart of Accounts...');

  const existing = await prisma.chartOfAccount.findFirst({
    where: { organisationId, systemKey: 'AR' },
  });
  if (existing) {
    return;
  }

  const idByCode = new Map<string, string>();
  for (const account of BOBY_BITES_CHART_OF_ACCOUNTS) {
    const created = await prisma.chartOfAccount.create({
      data: {
        organisationId,
        code: account.code,
        name: account.name,
        type: account.type as never,
        description: null,
        isSystemAccount: Boolean(account.systemKey),
        systemKey: account.systemKey,
        createdById: actorUserId,
        updatedById: actorUserId,
        ...(account.parentCode ? { parentId: idByCode.get(account.parentCode) } : {}),
      },
    });
    idByCode.set(account.code, created.id);
  }
}

/** Sprint 8 — standalone, independently idempotency-gated backfill for the
 *  `GRNI_PENDING_APPROVAL` account, so a dev database that already ran
 *  `seedChartOfAccounts` before Sprint 8 (and therefore hit that function's own
 *  early-return gate) still receives the new account on a re-seed. Resolves `2100`'s
 *  id as the parent since `seedChartOfAccounts`'s own `idByCode` map is local to that
 *  function and unavailable here. */
async function seedGrniPendingApprovalAccount(
  organisationId: string,
  actorUserId: string,
): Promise<void> {
  const existing = await prisma.chartOfAccount.findFirst({
    where: { organisationId, systemKey: 'GRNI_PENDING_APPROVAL' },
  });
  if (existing) {
    return;
  }

  const parent = await prisma.chartOfAccount.findFirst({
    where: { organisationId, code: '2100' },
  });
  await prisma.chartOfAccount.create({
    data: {
      organisationId,
      code: '2110',
      name: 'Goods Received – Pending Approval',
      type: 'LIABILITY',
      description: null,
      isSystemAccount: true,
      systemKey: 'GRNI_PENDING_APPROVAL',
      createdById: actorUserId,
      updatedById: actorUserId,
      parentId: parent?.id,
    },
  });
}

/** Sprint 9 — standalone, independently idempotency-gated backfill for the three new
 *  Production-accounting system accounts, so a dev database that already ran
 *  `seedChartOfAccounts` before Sprint 9 still receives them on a re-seed: elevates
 *  the already-seeded-but-non-system `1330 Finished Goods` row to a real system
 *  account (an `update`, not a `create`), and creates `1340 Work In Progress`/
 *  `6600 Production Loss / Scrap` if missing (same "create if missing" shape as
 *  `seedGrniPendingApprovalAccount`). */
async function seedProductionAccountingAccounts(
  organisationId: string,
  actorUserId: string,
): Promise<void> {
  const finishedGoods = await prisma.chartOfAccount.findFirst({
    where: { organisationId, code: '1330' },
  });
  if (finishedGoods && !finishedGoods.systemKey) {
    await prisma.chartOfAccount.update({
      where: { id: finishedGoods.id },
      data: { isSystemAccount: true, systemKey: 'FINISHED_GOODS_INVENTORY' },
    });
  }

  const existingWip = await prisma.chartOfAccount.findFirst({
    where: { organisationId, systemKey: 'WIP' },
  });
  if (!existingWip) {
    await prisma.chartOfAccount.create({
      data: {
        organisationId,
        code: '1340',
        name: 'Work In Progress',
        type: 'ASSET',
        description: null,
        isSystemAccount: true,
        systemKey: 'WIP',
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    });
  }

  const existingLoss = await prisma.chartOfAccount.findFirst({
    where: { organisationId, systemKey: 'PRODUCTION_LOSS' },
  });
  if (!existingLoss) {
    const expensesParent = await prisma.chartOfAccount.findFirst({
      where: { organisationId, code: '6000' },
    });
    await prisma.chartOfAccount.create({
      data: {
        organisationId,
        code: '6600',
        name: 'Production Loss / Scrap',
        type: 'EXPENSE',
        description: null,
        isSystemAccount: true,
        systemKey: 'PRODUCTION_LOSS',
        createdById: actorUserId,
        updatedById: actorUserId,
        parentId: expensesParent?.id,
      },
    });
  }
}

/** Two periods: "July 2026" (created, used to post `INV-000003`'s historical journal
 *  inside `seedFinance`, then closed — demonstrating a real closed period with real
 *  posted history) and "August 2026" (left `OPEN`, covering every other seeded
 *  fixture's date and "today" for live verification). Idempotency-gated on "August
 *  2026" already existing. */
async function seedAccountingPeriods(organisationId: string, actorUserId: string): Promise<void> {
  console.log('Seeding Accounting Periods...');

  const existing = await prisma.accountingPeriod.findFirst({
    where: { organisationId, name: 'August 2026' },
  });
  if (existing) {
    return;
  }

  await prisma.accountingPeriod.create({
    data: {
      organisationId,
      name: 'July 2026',
      startDate: new Date('2026-07-01'),
      endDate: new Date('2026-07-31'),
      status: 'OPEN',
      createdById: actorUserId,
    },
  });
  await prisma.accountingPeriod.create({
    data: {
      organisationId,
      name: 'August 2026',
      startDate: new Date('2026-08-01'),
      endDate: new Date('2026-08-31'),
      status: 'OPEN',
      createdById: actorUserId,
    },
  });
}

/**
 * A local, self-contained equivalent of
 * `apps/api/src/finance/accounting/journal-posting.ts`'s `postSystemJournalEntry` —
 * deliberately re-implemented here rather than imported, matching this script's
 * established convention (see this function's sibling `buildInvoiceItem`, which
 * likewise re-derives `InvoiceService`'s own tax/subtotal math locally): `prisma/
 * seed.ts` runs as a standalone `ts-node` script outside `src/`'s `tsconfig.json`
 * `rootDir`, and every prior sprint's seed additions have written directly against
 * Prisma rather than importing domain code. Kept behaviourally identical to the real
 * function — same idempotency-by-`(organisationId, sourceType, sourceId)` guarantee,
 * same `JE-000001` numbering, same system-account/open-period resolution — so the
 * seeded ledger is indistinguishable from one the live application produced.
 */
async function postSeedJournalEntry(
  organisationId: string,
  input: {
    date: Date;
    description: string;
    reference?: string;
    sourceType: string;
    sourceId: string;
    actorUserId: string;
    /** Exactly one of `systemKey`/`accountId` per line — added Sprint 14 to mirror
     *  the real `journal-posting.ts`'s own `accountId` alternative (cash-account
     *  postings target a specific, non-system CoA row, never a system key). */
    lines: { systemKey?: string; accountId?: string; debit?: number; credit?: number }[];
  },
): Promise<{
  id: string;
  lines: { id: string; accountId: string; debit: number; credit: number }[];
}> {
  const existing = await prisma.journalEntry.findUnique({
    where: {
      organisationId_sourceType_sourceId: {
        organisationId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    },
    include: { lines: true },
  });
  if (existing) {
    return existing;
  }

  const period = await prisma.accountingPeriod.findFirst({
    where: {
      organisationId,
      status: 'OPEN',
      startDate: { lte: input.date },
      endDate: { gte: input.date },
    },
  });
  if (!period) {
    throw new Error(
      `seedFinance: no open accounting period covers ${input.date.toISOString().slice(0, 10)} — seedAccountingPeriods must run first`,
    );
  }

  const lines = await Promise.all(
    input.lines.map(async (line) => {
      const account = line.accountId
        ? await prisma.chartOfAccount.findFirst({ where: { organisationId, id: line.accountId } })
        : await prisma.chartOfAccount.findFirst({
            where: { organisationId, systemKey: line.systemKey },
          });
      if (!account) {
        throw new Error(`seedFinance: no "${line.systemKey ?? line.accountId}" account configured`);
      }
      return {
        accountId: account.id,
        debit: line.debit ?? 0,
        credit: line.credit ?? 0,
      };
    }),
  );

  let sequence = 1;
  let journalNumber = `JE-${String(sequence).padStart(6, '0')}`;
  while (
    await prisma.journalEntry.findUnique({
      where: { organisationId_journalNumber: { organisationId, journalNumber } },
    })
  ) {
    sequence += 1;
    journalNumber = `JE-${String(sequence).padStart(6, '0')}`;
  }

  return prisma.journalEntry.create({
    data: {
      organisationId,
      journalNumber,
      date: input.date,
      accountingPeriodId: period.id,
      description: input.description,
      reference: input.reference,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      status: 'POSTED',
      postedAt: new Date(),
      createdById: input.actorUserId,
      lines: { create: lines },
    },
    include: { lines: true },
  });
}

/**
 * Sprint 6's Finance fixtures (docs/domains/finance.md) — four invoices covering every
 * lifecycle state the brief asks to see seeded: a fully PAID invoice via two
 * installments, a PARTIALLY_PAID invoice with a Credit Note applied, an OVERDUE invoice
 * (backdated due date — flips live via `InvoiceRepository`'s lazy sweep on first read,
 * not pre-set here), and a plain outstanding ISSUED invoice not yet due.
 *
 * Bypasses `InvoiceService`/`PaymentService`/`CreditNoteService` and writes the same
 * shape of data directly, same convention as `seedDispatchesAndDeliveries` — mirroring
 * each real atomic write's own step order so the seeded rows are byte-consistent with
 * what those services would themselves have produced. Idempotent via a single upfront
 * `INV-000001` existence check.
 */
async function seedFinance(
  organisationId: string,
  actorUserId: string,
  salesOrdersByCode: Record<string, { id: string }>,
  customersByCode: Record<string, string>,
  productsByCode: Record<string, string>,
): Promise<void> {
  console.log('Seeding Finance fixtures (invoices, payments, credit note)...');

  const existingInvoice = await prisma.invoice.findUnique({ where: { invoiceCode: 'INV-000001' } });
  if (existingInvoice) {
    return;
  }

  const productId = productsByCode['PRD-000027']!;
  const productCode = 'PRD-000027';
  const productName = 'Plantain Chips Classic Salted 500g';

  async function buildInvoiceItem(salesOrderId: string, unitPrice: number, taxRate: number) {
    const orderItem = await prisma.salesOrderItem.findFirstOrThrow({
      where: { salesOrderId, productId },
    });
    const quantity = orderItem.quantity;
    const lineSubtotal = quantity * unitPrice;
    const taxAmount = (lineSubtotal * taxRate) / 100;
    return {
      subtotal: lineSubtotal,
      taxAmount,
      total: lineSubtotal + taxAmount,
      item: {
        productId,
        productCode,
        productName,
        quantity,
        unitPrice,
        discount: 0,
        taxRate,
        taxAmount,
        lineTotal: lineSubtotal + taxAmount,
        salesOrderItemId: orderItem.id,
      },
    };
  }

  // --- INV-000001 — SO-000012, ABC Supermarket, paid in full across two installments.
  const order1 = salesOrdersByCode['SO-000012']!;
  const item1 = await buildInvoiceItem(order1.id, 5000, 0);
  const invoice1 = await prisma.invoice.create({
    data: {
      organisationId,
      invoiceCode: 'INV-000001',
      customerId: customersByCode['CUS-000013']!,
      salesOrderId: order1.id,
      invoiceDate: new Date('2026-08-20'),
      dueDate: new Date('2026-08-20'),
      paymentTerms: 'DUE_ON_RECEIPT',
      status: 'ISSUED',
      currency: 'NGN',
      subtotal: item1.subtotal,
      discount: 0,
      taxAmount: item1.taxAmount,
      total: item1.total,
      amountPaid: 2_500_000,
      createdById: actorUserId,
      updatedById: actorUserId,
      items: { create: [item1.item] },
    },
  });
  await prisma.invoice.update({ where: { id: invoice1.id }, data: { status: 'PAID' } });
  await postSeedJournalEntry(organisationId, {
    date: invoice1.invoiceDate,
    description: `Invoice ${invoice1.invoiceCode} issued`,
    reference: invoice1.invoiceCode,
    sourceType: 'INVOICE',
    sourceId: invoice1.id,
    actorUserId,
    lines: [
      { systemKey: 'AR', debit: invoice1.total },
      { systemKey: 'SALES_REVENUE', credit: invoice1.total },
    ],
  });
  const payment1a = await prisma.payment.create({
    data: {
      organisationId,
      customerId: customersByCode['CUS-000013']!,
      paymentDate: new Date('2026-08-21'),
      amount: 1_000_000,
      currency: 'NGN',
      method: 'BANK_TRANSFER',
      reference: 'TXN-ABC-001',
      status: 'RECORDED',
      idempotencyKey: 'seed-PAY-INV-000001-1',
      createdById: actorUserId,
      allocations: { create: [{ invoiceId: invoice1.id, amount: 1_000_000 }] },
    },
  });
  await postSeedJournalEntry(organisationId, {
    date: payment1a.paymentDate,
    description: `Payment received against ${invoice1.invoiceCode}`,
    reference: payment1a.reference ?? undefined,
    sourceType: 'PAYMENT',
    sourceId: payment1a.id,
    actorUserId,
    lines: [
      { systemKey: 'BANK', debit: payment1a.amount },
      { systemKey: 'AR', credit: payment1a.amount },
    ],
  });
  const payment1b = await prisma.payment.create({
    data: {
      organisationId,
      customerId: customersByCode['CUS-000013']!,
      paymentDate: new Date('2026-08-22'),
      amount: 1_500_000,
      currency: 'NGN',
      method: 'BANK_TRANSFER',
      reference: 'TXN-ABC-002',
      status: 'RECORDED',
      idempotencyKey: 'seed-PAY-INV-000001-2',
      createdById: actorUserId,
      allocations: { create: [{ invoiceId: invoice1.id, amount: 1_500_000 }] },
    },
  });
  await postSeedJournalEntry(organisationId, {
    date: payment1b.paymentDate,
    description: `Payment received against ${invoice1.invoiceCode}`,
    reference: payment1b.reference ?? undefined,
    sourceType: 'PAYMENT',
    sourceId: payment1b.id,
    actorUserId,
    lines: [
      { systemKey: 'BANK', debit: payment1b.amount },
      { systemKey: 'AR', credit: payment1b.amount },
    ],
  });

  // --- INV-000002 — SO-000013, ABC Supermarket, partially paid + a Credit Note for
  // returned goods. Outstanding must correctly reflect both the payment and the credit.
  const order2 = salesOrdersByCode['SO-000013']!;
  const item2 = await buildInvoiceItem(order2.id, 5000, 0);
  const invoice2 = await prisma.invoice.create({
    data: {
      organisationId,
      invoiceCode: 'INV-000002',
      customerId: customersByCode['CUS-000013']!,
      salesOrderId: order2.id,
      invoiceDate: new Date('2026-08-20'),
      dueDate: new Date('2026-08-20'),
      paymentTerms: 'DUE_ON_RECEIPT',
      status: 'ISSUED',
      currency: 'NGN',
      subtotal: item2.subtotal,
      discount: 0,
      taxAmount: item2.taxAmount,
      total: item2.total,
      amountPaid: 1_000_000,
      amountCredited: 250_000,
      createdById: actorUserId,
      updatedById: actorUserId,
      items: { create: [item2.item] },
    },
  });
  await prisma.invoice.update({ where: { id: invoice2.id }, data: { status: 'PARTIALLY_PAID' } });
  await postSeedJournalEntry(organisationId, {
    date: invoice2.invoiceDate,
    description: `Invoice ${invoice2.invoiceCode} issued`,
    reference: invoice2.invoiceCode,
    sourceType: 'INVOICE',
    sourceId: invoice2.id,
    actorUserId,
    lines: [
      { systemKey: 'AR', debit: invoice2.total },
      { systemKey: 'SALES_REVENUE', credit: invoice2.total },
    ],
  });
  const payment2 = await prisma.payment.create({
    data: {
      organisationId,
      customerId: customersByCode['CUS-000013']!,
      paymentDate: new Date('2026-08-21'),
      amount: 1_000_000,
      currency: 'NGN',
      method: 'BANK_TRANSFER',
      reference: 'TXN-ABC-003',
      status: 'RECORDED',
      idempotencyKey: 'seed-PAY-INV-000002-1',
      createdById: actorUserId,
      allocations: { create: [{ invoiceId: invoice2.id, amount: 1_000_000 }] },
    },
  });
  await postSeedJournalEntry(organisationId, {
    date: payment2.paymentDate,
    description: `Payment received against ${invoice2.invoiceCode}`,
    reference: payment2.reference ?? undefined,
    sourceType: 'PAYMENT',
    sourceId: payment2.id,
    actorUserId,
    lines: [
      { systemKey: 'BANK', debit: payment2.amount },
      { systemKey: 'AR', credit: payment2.amount },
    ],
  });
  const creditNote1 = await prisma.creditNote.create({
    data: {
      organisationId,
      creditNoteCode: 'CN-000001',
      customerId: customersByCode['CUS-000013']!,
      invoiceId: invoice2.id,
      reason: 'Returned goods — damaged in transit, 25 packs',
      amount: 250_000,
      currency: 'NGN',
      status: 'ISSUED',
      creditNoteDate: new Date('2026-08-22'),
      idempotencyKey: 'seed-CN-000001-1',
      createdById: actorUserId,
      updatedById: actorUserId,
    },
  });
  await postSeedJournalEntry(organisationId, {
    date: creditNote1.creditNoteDate,
    description: `Credit note ${creditNote1.creditNoteCode} issued against ${invoice2.invoiceCode}`,
    reference: creditNote1.creditNoteCode,
    sourceType: 'CREDIT_NOTE',
    sourceId: creditNote1.id,
    actorUserId,
    lines: [
      { systemKey: 'SALES_RETURNS', debit: creditNote1.amount },
      { systemKey: 'AR', credit: creditNote1.amount },
    ],
  });

  // --- INV-000003 — SO-000011, Mama Nkechi Stores, backdated due date, no payment.
  // Deliberately seeded ISSUED (not OVERDUE) — `InvoiceRepository`'s lazy sweep flips it
  // live on first read, demonstrating that mechanism rather than pre-empting it here.
  const order3 = salesOrdersByCode['SO-000011']!;
  const item3 = await buildInvoiceItem(order3.id, 3200, 7.5);
  const invoice3 = await prisma.invoice.create({
    data: {
      organisationId,
      invoiceCode: 'INV-000003',
      customerId: customersByCode['CUS-000012']!,
      salesOrderId: order3.id,
      invoiceDate: new Date('2026-07-01'),
      dueDate: new Date('2026-07-15'),
      paymentTerms: 'NET_14',
      status: 'ISSUED',
      currency: 'NGN',
      subtotal: item3.subtotal,
      discount: 0,
      taxAmount: item3.taxAmount,
      total: item3.total,
      createdById: actorUserId,
      updatedById: actorUserId,
      items: { create: [item3.item] },
    },
  });
  await postSeedJournalEntry(organisationId, {
    date: invoice3.invoiceDate,
    description: `Invoice ${invoice3.invoiceCode} issued`,
    reference: invoice3.invoiceCode,
    sourceType: 'INVOICE',
    sourceId: invoice3.id,
    actorUserId,
    lines: [
      { systemKey: 'AR', debit: invoice3.total },
      { systemKey: 'SALES_REVENUE', credit: invoice3.total },
    ],
  });

  // Close "July 2026" now that its only posting (INV-000003's journal, above) is
  // recorded — demonstrates a real closed period with real posted history, and
  // exercises the "closed periods reject new postings" rule live without the user
  // needing to close a period themselves before they can even see one.
  console.log('Closing accounting period "July 2026"...');
  await prisma.accountingPeriod.updateMany({
    where: { organisationId, name: 'July 2026', status: 'OPEN' },
    data: { status: 'CLOSED', closedAt: new Date(), closedById: actorUserId },
  });

  // --- INV-000004 — SO-000009, Amala Spot Restaurant, not yet due, no payment.
  const order4 = salesOrdersByCode['SO-000009']!;
  const item4 = await buildInvoiceItem(order4.id, 3200, 7.5);
  const invoice4 = await prisma.invoice.create({
    data: {
      organisationId,
      invoiceCode: 'INV-000004',
      customerId: customersByCode['CUS-000007']!,
      salesOrderId: order4.id,
      invoiceDate: new Date('2026-08-20'),
      dueDate: new Date('2026-09-03'),
      paymentTerms: 'NET_14',
      status: 'ISSUED',
      currency: 'NGN',
      subtotal: item4.subtotal,
      discount: 0,
      taxAmount: item4.taxAmount,
      total: item4.total,
      createdById: actorUserId,
      updatedById: actorUserId,
      items: { create: [item4.item] },
    },
  });
  await postSeedJournalEntry(organisationId, {
    date: invoice4.invoiceDate,
    description: `Invoice ${invoice4.invoiceCode} issued`,
    reference: invoice4.invoiceCode,
    sourceType: 'INVOICE',
    sourceId: invoice4.id,
    actorUserId,
    lines: [
      { systemKey: 'AR', debit: invoice4.total },
      { systemKey: 'SALES_REVENUE', credit: invoice4.total },
    ],
  });
}

// ============================================================================
// Sprint 14 — Cash & Bank Management / Reconciliation Foundation
// (docs/domains/cash-management.md)
// ============================================================================

/** Standalone, independently idempotency-gated backfill for the two new Sprint 14
 *  system accounts — same "elevate an already-seeded row" pattern
 *  `seedProductionAccountingAccounts` used for `FINISHED_GOODS_INVENTORY`. Elevates
 *  the already-seeded, non-system "1100 Cash & Bank" row to `CASH_BANK_PARENT` and
 *  "3100 Owner's Capital" to `OPENING_BALANCE_EQUITY`. */
async function seedCashBankSystemAccounts(organisationId: string): Promise<void> {
  const cashBankParent = await prisma.chartOfAccount.findFirst({
    where: { organisationId, code: '1100' },
  });
  if (cashBankParent && !cashBankParent.systemKey) {
    await prisma.chartOfAccount.update({
      where: { id: cashBankParent.id },
      data: { isSystemAccount: true, systemKey: 'CASH_BANK_PARENT' },
    });
  }

  const ownersCapital = await prisma.chartOfAccount.findFirst({
    where: { organisationId, code: '3100' },
  });
  if (ownersCapital && !ownersCapital.systemKey) {
    await prisma.chartOfAccount.update({
      where: { id: ownersCapital.id },
      data: { isSystemAccount: true, systemKey: 'OPENING_BALANCE_EQUITY' },
    });
  }
}

/** Two plain, non-system Chart of Accounts rows Sprint 14's seeded `CashTransaction`
 *  fixtures post against as their "contra account" — "Other Income" (for
 *  non-invoice POS receipts) and "Bank Charges" (for bank fees). Neither existed
 *  before Sprint 14; both are ordinary tenant-defined accounts, not system ones. */
async function seedCashTransactionContraAccounts(
  organisationId: string,
  actorUserId: string,
): Promise<{ otherIncomeId: string; bankChargesId: string }> {
  let otherIncome = await prisma.chartOfAccount.findFirst({
    where: { organisationId, code: '4300' },
  });
  if (!otherIncome) {
    const revenueParent = await prisma.chartOfAccount.findFirst({
      where: { organisationId, code: '4000' },
    });
    otherIncome = await prisma.chartOfAccount.create({
      data: {
        organisationId,
        code: '4300',
        name: 'Other Income',
        type: 'REVENUE',
        parentId: revenueParent?.id,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    });
  }

  let bankCharges = await prisma.chartOfAccount.findFirst({
    where: { organisationId, code: '6700' },
  });
  if (!bankCharges) {
    const expensesParent = await prisma.chartOfAccount.findFirst({
      where: { organisationId, code: '6000' },
    });
    bankCharges = await prisma.chartOfAccount.create({
      data: {
        organisationId,
        code: '6700',
        name: 'Bank Charges',
        type: 'EXPENSE',
        parentId: expensesParent?.id,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    });
  }

  return { otherIncomeId: otherIncome.id, bankChargesId: bankCharges.id };
}

/** `${parentCode}01`, `${parentCode}02`, ... — same shape as the real
 *  `CashAccountRepository`'s own `generateChildAccountCode` (never imported here —
 *  seed scripts in this repo never import from `src/`, see `seedFinance`'s own doc
 *  comment). */
async function generateSeedChildAccountCode(
  organisationId: string,
  parentCode: string,
): Promise<string> {
  let sequence = 1;
  let candidate = `${parentCode}${String(sequence).padStart(2, '0')}`;
  while (await prisma.chartOfAccount.findFirst({ where: { organisationId, code: candidate } })) {
    sequence += 1;
    candidate = `${parentCode}${String(sequence).padStart(2, '0')}`;
  }
  return candidate;
}

/** Mirrors `CashAccountRepository.create()`'s own logic (provision a dedicated
 *  child Chart of Accounts row under the `CASH`/`BANK`/`CASH_BANK_PARENT` system
 *  account, then post the opening balance) — never imported from `src/`, hand-
 *  rolled the same way every other seed fixture in this file mirrors its real
 *  service's shape. */
async function seedCashAccount(
  organisationId: string,
  actorUserId: string,
  input: {
    accountCode: string;
    name: string;
    accountType: 'BANK' | 'CASH' | 'OTHER_CASH_EQUIVALENT';
    currency: string;
    bankName?: string;
    accountNumber?: string;
    accountName?: string;
    openingBalance: number;
    openingBalanceDate: Date;
  },
): Promise<{ id: string; linkedChartOfAccountId: string }> {
  const existing = await prisma.cashAccount.findFirst({
    where: { organisationId, accountCode: input.accountCode },
  });
  if (existing) {
    return existing;
  }

  const parentSystemKey =
    input.accountType === 'BANK'
      ? 'BANK'
      : input.accountType === 'CASH'
        ? 'CASH'
        : 'CASH_BANK_PARENT';
  const parent = await prisma.chartOfAccount.findFirstOrThrow({
    where: { organisationId, systemKey: parentSystemKey },
  });
  const childCode = await generateSeedChildAccountCode(organisationId, parent.code);
  const linkedChartOfAccount = await prisma.chartOfAccount.create({
    data: {
      organisationId,
      code: childCode,
      name: input.name,
      type: parent.type,
      parentId: parent.id,
      isSystemAccount: false,
      createdById: actorUserId,
      updatedById: actorUserId,
    },
  });

  const cashAccount = await prisma.cashAccount.create({
    data: {
      organisationId,
      accountCode: input.accountCode,
      name: input.name,
      accountType: input.accountType,
      currency: input.currency,
      bankName: input.bankName,
      accountNumber: input.accountNumber,
      accountName: input.accountName,
      linkedChartOfAccountId: linkedChartOfAccount.id,
      openingBalance: input.openingBalance,
      openingBalanceDate: input.openingBalanceDate,
      createdById: actorUserId,
      updatedById: actorUserId,
    },
  });

  if (input.openingBalance > 0) {
    await postSeedJournalEntry(organisationId, {
      date: input.openingBalanceDate,
      description: `Opening balance — ${input.name}`,
      sourceType: 'CASH_ACCOUNT_OPENING_BALANCE',
      sourceId: cashAccount.id,
      actorUserId,
      lines: [
        { accountId: linkedChartOfAccount.id, debit: input.openingBalance },
        { systemKey: 'OPENING_BALANCE_EQUITY', credit: input.openingBalance },
      ],
    });
  }

  return cashAccount;
}

/**
 * Sprint 14 fixtures (docs/domains/cash-management.md) — three Cash Accounts
 * (GTBank, Access Bank, Petty Cash), a handful of `CashTransaction`s outside the
 * existing Payment/SupplierPayment flows, a CSV-style bank statement import for
 * GTBank, and two reconciliation sessions: an earlier period fully matched and
 * `COMPLETED` (demonstrating a proven, immutable reconciliation), and an August
 * period left deliberately `IN_PROGRESS` with one matched pair, one unmatched bank
 * transaction, and one unmatched book transaction — the exact starting state the
 * live-verification scenario resolves and completes. Idempotent via a single
 * upfront `CASH-001` existence check; entirely independent of `seedFinance`'s own
 * gated fixtures (no shared idempotency key, no shared source rows).
 */
async function seedCashAndBank(organisationId: string, actorUserId: string): Promise<void> {
  console.log('Seeding Cash & Bank Management fixtures...');

  const existing = await prisma.cashAccount.findFirst({
    where: { organisationId, accountCode: 'CASH-001' },
  });
  if (existing) {
    return;
  }

  await seedCashBankSystemAccounts(organisationId);
  const { otherIncomeId, bankChargesId } = await seedCashTransactionContraAccounts(
    organisationId,
    actorUserId,
  );

  const gtBank = await seedCashAccount(organisationId, actorUserId, {
    accountCode: 'CASH-001',
    name: 'GTBank Current Account',
    accountType: 'BANK',
    currency: 'NGN',
    bankName: 'GTBank',
    accountNumber: '0123456789',
    accountName: 'Boby Bites Nigeria Ltd',
    openingBalance: 10_000_000,
    openingBalanceDate: new Date('2026-08-01'),
  });
  await seedCashAccount(organisationId, actorUserId, {
    accountCode: 'CASH-002',
    name: 'Access Bank Current Account',
    accountType: 'BANK',
    currency: 'NGN',
    bankName: 'Access Bank',
    accountNumber: '0987654321',
    accountName: 'Boby Bites Nigeria Ltd',
    openingBalance: 2_000_000,
    openingBalanceDate: new Date('2026-08-01'),
  });
  await seedCashAccount(organisationId, actorUserId, {
    accountCode: 'CASH-003',
    name: 'Petty Cash',
    accountType: 'CASH',
    currency: 'NGN',
    openingBalance: 200_000,
    openingBalanceDate: new Date('2026-08-01'),
  });

  async function postCashTransaction(input: {
    sourceId: string;
    transactionType: 'RECEIPT' | 'PAYMENT';
    date: Date;
    amount: number;
    description: string;
    contraAccountId: string;
  }): Promise<{ id: string; journalEntryLineId: string }> {
    const cashTransaction = await prisma.cashTransaction.create({
      data: {
        organisationId,
        cashAccountId: gtBank.id,
        transactionType: input.transactionType,
        transactionDate: input.date,
        amount: input.amount,
        description: input.description,
        contraAccountId: input.contraAccountId,
        idempotencyKey: `seed-${input.sourceId}`,
        createdById: actorUserId,
      },
    });
    const posting = await postSeedJournalEntry(organisationId, {
      date: input.date,
      description: input.description,
      sourceType: 'CASH_TRANSACTION',
      sourceId: cashTransaction.id,
      actorUserId,
      lines:
        input.transactionType === 'RECEIPT'
          ? [
              { accountId: gtBank.linkedChartOfAccountId, debit: input.amount },
              { accountId: input.contraAccountId, credit: input.amount },
            ]
          : [
              { accountId: input.contraAccountId, debit: input.amount },
              { accountId: gtBank.linkedChartOfAccountId, credit: input.amount },
            ],
    });
    const cashAccountLine = posting.lines.find(
      (line) => line.accountId === gtBank.linkedChartOfAccountId,
    )!;
    return { id: cashTransaction.id, journalEntryLineId: cashAccountLine.id };
  }

  // --- Period 1 (2-3 Aug) — cleanly matched, reconciled and COMPLETED below.
  const ct1 = await postCashTransaction({
    sourceId: 'CT-SEED-1',
    transactionType: 'RECEIPT',
    date: new Date('2026-08-02'),
    amount: 300_000,
    description: 'POS Settlement',
    contraAccountId: otherIncomeId,
  });
  const ct2 = await postCashTransaction({
    sourceId: 'CT-SEED-2',
    transactionType: 'PAYMENT',
    date: new Date('2026-08-03'),
    amount: 5_000,
    description: 'Bank Charge',
    contraAccountId: bankChargesId,
  });

  // --- Period 2 (6-31 Aug) — the main, deliberately-unresolved scenario.
  const ct3 = await postCashTransaction({
    sourceId: 'CT-SEED-3',
    transactionType: 'RECEIPT',
    date: new Date('2026-08-10'),
    amount: 850_000,
    description: 'POS Settlement',
    contraAccountId: otherIncomeId,
  });
  // ct4 (₦45,000 "Petty cash top-up transfer") is deliberately left with no
  // matching bank statement row — an "unmatched book transaction" for the live
  // -verification scenario to resolve (docs/domains/cash-management.md
  // "Reconciliation").
  await postCashTransaction({
    sourceId: 'CT-SEED-4',
    transactionType: 'PAYMENT',
    date: new Date('2026-08-15'),
    amount: 45_000,
    description: 'Petty cash top-up transfer',
    contraAccountId: bankChargesId,
  });

  // --- Bank statement import (one CSV-style batch covering both periods).
  function dedupeHash(row: {
    date: Date;
    debit: number;
    credit: number;
    reference: string;
    description: string;
  }): string {
    const input = [
      gtBank.id,
      row.date.toISOString().slice(0, 10),
      row.debit.toFixed(2),
      row.credit.toFixed(2),
      row.reference.trim().toLowerCase(),
      row.description.trim().toLowerCase(),
    ].join('|');
    return createHash('sha256').update(input).digest('hex');
  }

  const importRows = [
    {
      date: new Date('2026-08-02'),
      description: 'POS Settlement',
      reference: 'POS-0802',
      debit: 0,
      credit: 300_000,
    },
    {
      date: new Date('2026-08-03'),
      description: 'Bank Charge',
      reference: 'CHG-0803',
      debit: 5_000,
      credit: 0,
    },
    {
      date: new Date('2026-08-10'),
      description: 'POS Settlement',
      reference: 'POS-0810',
      debit: 0,
      credit: 850_000,
    },
    // Deliberately unmatched bank transaction (a card-processing fee the books
    // haven't recorded yet) — resolved live during verification.
    {
      date: new Date('2026-08-20'),
      description: 'Card Processing Fee',
      reference: 'FEE-0820',
      debit: 12_000,
      credit: 0,
    },
  ];

  const existingImport = await prisma.bankStatementImport.findFirst({
    where: { organisationId, cashAccountId: gtBank.id, idempotencyKey: 'seed-BSI-2026-08' },
  });
  const bankStatementImport =
    existingImport ??
    (await prisma.bankStatementImport.create({
      data: {
        organisationId,
        cashAccountId: gtBank.id,
        filename: 'gtbank-august-2026.csv',
        importedById: actorUserId,
        idempotencyKey: 'seed-BSI-2026-08',
        totalRows: importRows.length,
        importedRows: importRows.length,
        duplicateRows: 0,
        errorRows: 0,
      },
    }));

  const bankTransactionsByReference = new Map<string, { id: string }>();
  if (!existingImport) {
    for (const row of importRows) {
      const created = await prisma.bankStatementTransaction.create({
        data: {
          organisationId,
          cashAccountId: gtBank.id,
          importBatchId: bankStatementImport.id,
          transactionDate: row.date,
          description: row.description,
          reference: row.reference,
          debit: row.debit,
          credit: row.credit,
          amount: roundCurrencySeed(row.credit - row.debit),
          dedupeHash: dedupeHash(row),
        },
      });
      bankTransactionsByReference.set(row.reference, created);
    }
  } else {
    const rows = await prisma.bankStatementTransaction.findMany({
      where: { importBatchId: bankStatementImport.id },
    });
    for (const row of rows) {
      if (row.reference) bankTransactionsByReference.set(row.reference, row);
    }
  }

  // --- Reconciliation 1 (Aug 1-5) — fully matched, COMPLETED.
  const existingRecon1 = await prisma.bankReconciliation.findFirst({
    where: { organisationId, cashAccountId: gtBank.id, idempotencyKey: 'seed-RECON-2026-08-P1' },
  });
  if (!existingRecon1) {
    const recon1 = await prisma.bankReconciliation.create({
      data: {
        organisationId,
        cashAccountId: gtBank.id,
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-05'),
        openingBankBalance: 10_000_000,
        closingBankBalance: 10_295_000,
        status: 'IN_PROGRESS',
        idempotencyKey: 'seed-RECON-2026-08-P1',
        createdById: actorUserId,
      },
    });
    await prisma.reconciliationMatch.create({
      data: {
        bankReconciliationId: recon1.id,
        bankStatementTransactionId: bankTransactionsByReference.get('POS-0802')!.id,
        journalEntryLineId: ct1.journalEntryLineId,
        matchType: 'EXACT_AUTO',
        matchedById: actorUserId,
      },
    });
    await prisma.reconciliationMatch.create({
      data: {
        bankReconciliationId: recon1.id,
        bankStatementTransactionId: bankTransactionsByReference.get('CHG-0803')!.id,
        journalEntryLineId: ct2.journalEntryLineId,
        matchType: 'EXACT_AUTO',
        matchedById: actorUserId,
      },
    });
    await prisma.bankStatementTransaction.updateMany({
      where: {
        id: {
          in: [
            bankTransactionsByReference.get('POS-0802')!.id,
            bankTransactionsByReference.get('CHG-0803')!.id,
          ],
        },
      },
      data: { matchStatus: 'RECONCILED' },
    });
    await prisma.bankReconciliation.update({
      where: { id: recon1.id },
      data: { status: 'COMPLETED', reconciledById: actorUserId, reconciledAt: new Date() },
    });
  }

  // --- Reconciliation 2 (Aug 6-31) — IN_PROGRESS, one matched pair (auto-matched
  // during live verification), one unmatched bank txn, one unmatched book txn.
  const existingRecon2 = await prisma.bankReconciliation.findFirst({
    where: { organisationId, cashAccountId: gtBank.id, idempotencyKey: 'seed-RECON-2026-08-P2' },
  });
  if (!existingRecon2) {
    const recon2 = await prisma.bankReconciliation.create({
      data: {
        organisationId,
        cashAccountId: gtBank.id,
        periodStart: new Date('2026-08-06'),
        periodEnd: new Date('2026-08-31'),
        openingBankBalance: 10_295_000,
        closingBankBalance: 11_133_000,
        status: 'IN_PROGRESS',
        idempotencyKey: 'seed-RECON-2026-08-P2',
        createdById: actorUserId,
      },
    });
    await prisma.reconciliationMatch.create({
      data: {
        bankReconciliationId: recon2.id,
        bankStatementTransactionId: bankTransactionsByReference.get('POS-0810')!.id,
        journalEntryLineId: ct3.journalEntryLineId,
        matchType: 'EXACT_AUTO',
        matchedById: actorUserId,
      },
    });
    await prisma.bankStatementTransaction.update({
      where: { id: bankTransactionsByReference.get('POS-0810')!.id },
      data: { matchStatus: 'MATCHED' },
    });
    // 'FEE-0820' (unmatched bank) and CT-SEED-4 (unmatched book) are deliberately
    // left unmatched — see the function's own doc comment.
  }
}

// ============================================================================
// Sprint 15 — Cashflow Management & Forecasting (docs/domains/cashflow.md)
// ============================================================================

/**
 * Sprint 15 fixtures — a fresh, dedicated outstanding customer invoice
 * (₦8,000,000, due in 14 days) and supplier invoice (₦5,000,000, due in 10 days,
 * posted Path B against Raw Materials — mirrors `SupplierInvoiceRepository.post()`'s
 * own Path B shape, docs/domains/finance.md §12), a recurring monthly rent item, a
 * one-time manual "expected additional collection" item, a large one-time planned
 * equipment payment (deliberately large enough to demonstrate a real projected
 * shortfall against this environment's own accumulated cash balance, regardless of
 * how much prior live-testing has already moved it — brief §38's "a healthy
 * forecast" and "a projected shortfall" in one coherent scenario: near-term
 * buckets stay healthy, the bucket the equipment payment lands in does not), three
 * scenarios (Base/Conservative/Optimistic), and a configured minimum cash
 * reserve. Entirely independent of `seedFinance`'s own gated fixtures — no shared
 * idempotency key, no shared source rows. Idempotent via a single upfront "Base"
 * scenario existence check.
 */
async function seedCashflowFixtures(organisationId: string, actorUserId: string): Promise<void> {
  console.log('Seeding Cashflow Management fixtures...');

  const existing = await prisma.cashflowScenario.findFirst({
    where: { organisationId, name: 'Base' },
  });
  if (existing) {
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  function daysFromNow(days: number): Date {
    const date = new Date(today);
    date.setDate(date.getDate() + days);
    return date;
  }

  // --- Outstanding customer invoice (AR) — brief §41's exact worked scenario.
  const customer = await prisma.customer.findFirstOrThrow({ where: { organisationId } });
  const arInvoice = await prisma.invoice.create({
    data: {
      organisationId,
      invoiceCode: 'CF-INV-0001',
      customerId: customer.id,
      invoiceDate: today,
      dueDate: daysFromNow(14),
      paymentTerms: 'NET_14',
      status: 'ISSUED',
      currency: 'NGN',
      subtotal: 8_000_000,
      taxAmount: 0,
      total: 8_000_000,
      createdById: actorUserId,
      updatedById: actorUserId,
      items: {
        create: [
          {
            productCode: 'CF-SEED',
            productName: 'Cashflow Seed Line Item',
            quantity: 1,
            unitPrice: 8_000_000,
            lineTotal: 8_000_000,
          },
        ],
      },
    },
  });
  await postSeedJournalEntry(organisationId, {
    date: arInvoice.invoiceDate,
    description: `Invoice ${arInvoice.invoiceCode} issued`,
    reference: arInvoice.invoiceCode,
    sourceType: 'INVOICE',
    sourceId: arInvoice.id,
    actorUserId,
    lines: [
      { systemKey: 'AR', debit: arInvoice.total },
      { systemKey: 'SALES_REVENUE', credit: arInvoice.total },
    ],
  });

  // --- Outstanding supplier invoice (AP), Path B (no Goods Receipt link) —
  // posts DR Raw Materials / CR AP, mirroring `SupplierInvoiceRepository.post()`'s
  // own Path B shape exactly.
  const supplier = await prisma.supplier.findFirstOrThrow({ where: { organisationId } });
  const rawMaterialsAccount = await prisma.chartOfAccount.findFirstOrThrow({
    where: { organisationId, code: '1310' },
  });
  const apInvoice = await prisma.supplierInvoice.create({
    data: {
      organisationId,
      supplierId: supplier.id,
      invoiceNumber: 'CF-SINV-0001',
      invoiceDate: today,
      dueDate: daysFromNow(10),
      paymentTerms: 'NET_14',
      status: 'POSTED',
      currency: 'NGN',
      subtotal: 5_000_000,
      taxAmount: 0,
      total: 5_000_000,
      matchStatus: 'UNVERIFIED',
      recognizedAmount: 5_000_000,
      varianceAmount: 0,
      postedAt: new Date(),
      postedById: actorUserId,
      createdById: actorUserId,
      updatedById: actorUserId,
      items: {
        create: [
          {
            description: 'Raw materials — cashflow seed line item',
            quantity: 1,
            unitPrice: 5_000_000,
            lineTotal: 5_000_000,
            debitAccountId: rawMaterialsAccount.id,
            recognizedAmount: 5_000_000,
            varianceAmount: 0,
          },
        ],
      },
    },
  });
  await postSeedJournalEntry(organisationId, {
    date: apInvoice.invoiceDate,
    description: `Supplier invoice ${apInvoice.invoiceNumber} posted`,
    reference: apInvoice.invoiceNumber,
    sourceType: 'SUPPLIER_INVOICE',
    sourceId: apInvoice.id,
    actorUserId,
    lines: [
      { accountId: rawMaterialsAccount.id, debit: apInvoice.total },
      { systemKey: 'AP', credit: apInvoice.total },
    ],
  });

  // --- Management-entered forecast items (docs/domains/cashflow.md §5/§6).
  await prisma.cashflowForecastItem.create({
    data: {
      organisationId,
      direction: 'OUTFLOW',
      sourceType: 'RECURRING_ITEM',
      description: 'Factory Rent',
      amount: 1_500_000,
      currency: 'NGN',
      expectedDate: daysFromNow(1),
      recurrence: 'MONTHLY',
      idempotencyKey: 'seed-CF-ITEM-RENT',
      createdById: actorUserId,
      updatedById: actorUserId,
    },
  });
  await prisma.cashflowForecastItem.create({
    data: {
      organisationId,
      direction: 'INFLOW',
      sourceType: 'MANUAL_FORECAST',
      description: 'Expected additional customer collection',
      amount: 4_000_000,
      currency: 'NGN',
      expectedDate: daysFromNow(20),
      recurrence: 'ONE_TIME',
      idempotencyKey: 'seed-CF-ITEM-MANUAL-COLLECTION',
      createdById: actorUserId,
      updatedById: actorUserId,
    },
  });
  await prisma.cashflowForecastItem.create({
    data: {
      organisationId,
      direction: 'OUTFLOW',
      sourceType: 'MANUAL_FORECAST',
      description: 'Planned Equipment Payment',
      amount: 20_000_000,
      currency: 'NGN',
      expectedDate: daysFromNow(45),
      recurrence: 'ONE_TIME',
      notes:
        'Deliberately large — demonstrates a real projected shortfall in the live-verification scenario (docs/domains/cashflow.md).',
      idempotencyKey: 'seed-CF-ITEM-EQUIPMENT',
      createdById: actorUserId,
      updatedById: actorUserId,
    },
  });

  // --- Scenarios (docs/domains/cashflow.md §7).
  await prisma.cashflowScenario.create({
    data: {
      organisationId,
      name: 'Base',
      description: 'Collections and payments as scheduled — no adjustment.',
      inflowDelayDays: 0,
      inflowMultiplier: 1,
      outflowDelayDays: 0,
      outflowMultiplier: 1,
      idempotencyKey: 'seed-CF-SCENARIO-BASE',
      createdById: actorUserId,
      updatedById: actorUserId,
    },
  });
  await prisma.cashflowScenario.create({
    data: {
      organisationId,
      name: 'Conservative',
      description: 'Customer collections delayed 30 days and reduced 20%; payments unchanged.',
      inflowDelayDays: 30,
      inflowMultiplier: 0.8,
      outflowDelayDays: 0,
      outflowMultiplier: 1,
      idempotencyKey: 'seed-CF-SCENARIO-CONSERVATIVE',
      createdById: actorUserId,
      updatedById: actorUserId,
    },
  });
  await prisma.cashflowScenario.create({
    data: {
      organisationId,
      name: 'Optimistic',
      description: 'Collections improve 15%.',
      inflowDelayDays: 0,
      inflowMultiplier: 1.15,
      outflowDelayDays: 0,
      outflowMultiplier: 1,
      idempotencyKey: 'seed-CF-SCENARIO-OPTIMISTIC',
      createdById: actorUserId,
      updatedById: actorUserId,
    },
  });

  // --- Minimum cash reserve (docs/domains/cashflow.md §9/§10).
  await prisma.cashflowSettings.create({
    data: {
      organisationId,
      minimumCashReserve: 5_000_000,
      defaultCollectionDelayDays: 0,
      defaultPaymentDelayDays: 0,
      updatedById: actorUserId,
    },
  });
}

/** Sprint 16 — Budgeting & Financial Planning Foundation (docs/domains/
 *  budgeting.md). Idempotency-gated on the "Base" 2026 Operating Budget
 *  already existing — every write inside is skipped on a re-seed. */
async function seedBudgetingFixtures(organisationId: string, actorUserId: string): Promise<void> {
  console.log('Seeding Budgeting & Financial Planning fixtures...');

  const existing = await prisma.budget.findFirst({
    where: { organisationId, budgetCode: 'BUD-2026-OPS', scenarioName: 'Base' },
  });
  if (existing) {
    return;
  }

  // --- Cost Centres (docs/domains/budgeting.md §10).
  const costCentreNames = [
    ['PROD', 'Production'],
    ['PROC', 'Procurement'],
    ['SALES', 'Sales'],
    ['DIST', 'Distribution'],
    ['FIN', 'Finance'],
    ['ADMIN', 'Administration'],
    ['MKT', 'Marketing'],
  ] as const;
  const costCentres: Record<string, { id: string }> = {};
  for (const [code, name] of costCentreNames) {
    costCentres[code] = await prisma.costCentre.create({
      data: { organisationId, code, name, createdById: actorUserId },
    });
  }

  // --- Chart of Accounts rows every budget line below plans against — all
  // pre-existing seeded rows, zero new accounts needed.
  const revenueAccount = await prisma.chartOfAccount.findFirstOrThrow({
    where: { organisationId, code: '4100' },
  });
  const salariesAccount = await prisma.chartOfAccount.findFirstOrThrow({
    where: { organisationId, code: '6100' },
  });
  const utilitiesAccount = await prisma.chartOfAccount.findFirstOrThrow({
    where: { organisationId, code: '6200' },
  });
  const rentAccount = await prisma.chartOfAccount.findFirstOrThrow({
    where: { organisationId, code: '6300' },
  });
  const transportAccount = await prisma.chartOfAccount.findFirstOrThrow({
    where: { organisationId, code: '6500' },
  });

  function monthlyLines(
    chartOfAccountId: string,
    lineType: 'REVENUE' | 'OPERATING_EXPENSE',
    monthlyAmount: number,
    costCentreId: string,
  ) {
    return Array.from({ length: 12 }, (_, month) => ({
      chartOfAccountId,
      costCentreId,
      lineType,
      periodMonth: new Date(2026, month, 1),
      amount: monthlyAmount,
      createdById: actorUserId,
      updatedById: actorUserId,
    }));
  }

  async function createBudgetWithLines(params: {
    scenarioName: string;
    revenueMonthly: number;
    status: 'DRAFT' | 'ACTIVE';
  }): Promise<void> {
    const budget = await prisma.budget.create({
      data: {
        organisationId,
        budgetCode: 'BUD-2026-OPS',
        name: '2026 Operating Budget',
        description:
          "Boby Bites' first full-year operating plan — revenue, salaries, utilities, rent, transport, and two CAPEX items.",
        fiscalYear: 2026,
        scenarioName: params.scenarioName,
        startDate: new Date(2026, 0, 1),
        endDate: new Date(2026, 11, 31),
        currency: 'NGN',
        status: params.status,
        approvedById: params.status === 'ACTIVE' ? actorUserId : undefined,
        approvedAt: params.status === 'ACTIVE' ? new Date() : undefined,
        activatedAt: params.status === 'ACTIVE' ? new Date() : undefined,
        createdById: actorUserId,
        lines: {
          create: [
            ...monthlyLines(
              revenueAccount.id,
              'REVENUE',
              params.revenueMonthly,
              costCentres.SALES!.id,
            ),
            ...monthlyLines(
              salariesAccount.id,
              'OPERATING_EXPENSE',
              600_000,
              costCentres.ADMIN!.id,
            ),
            ...monthlyLines(
              utilitiesAccount.id,
              'OPERATING_EXPENSE',
              120_000,
              costCentres.ADMIN!.id,
            ),
            // Matches Sprint 15's own seeded Factory Rent CashflowForecastItem
            // (₦1,500,000/month) — the two figures agree deliberately, so
            // Budget vs Cashflow Forecast reads coherently end-to-end.
            ...monthlyLines(rentAccount.id, 'OPERATING_EXPENSE', 1_500_000, costCentres.PROD!.id),
            ...monthlyLines(transportAccount.id, 'OPERATING_EXPENSE', 80_000, costCentres.DIST!.id),
          ],
        },
      },
    });

    if (params.status === 'ACTIVE') {
      // --- CAPEX (docs/domains/budgeting.md §6) — discrete named items, no
      // Chart of Accounts row (no Fixed Asset account exists yet).
      await prisma.budgetLine.createMany({
        data: [
          {
            budgetId: budget.id,
            costCentreId: costCentres.PROD!.id,
            lineType: 'CAPEX',
            periodMonth: new Date(2026, 5, 1),
            amount: 8_000_000,
            description: 'New Packaging Machine',
            createdById: actorUserId,
            updatedById: actorUserId,
          },
          {
            budgetId: budget.id,
            costCentreId: costCentres.DIST!.id,
            lineType: 'CAPEX',
            periodMonth: new Date(2026, 8, 1),
            amount: 3_500_000,
            description: 'Delivery Van',
            createdById: actorUserId,
            updatedById: actorUserId,
          },
        ],
      });
    }
  }

  // --- Base (₦3,000,000/month revenue), ACTIVE — the real, in-force plan
  // Budget vs Actual/Forecast compare against.
  await createBudgetWithLines({
    scenarioName: 'Base',
    revenueMonthly: 3_000_000,
    status: 'ACTIVE',
  });

  // --- Growth (₦3,900,000/month revenue, +30%), DRAFT — a what-if sibling
  // sharing the same budgetCode+fiscalYear, never activated, never touching
  // the Base budget's own lines or any GL data (docs/domains/budgeting.md §4).
  await createBudgetWithLines({
    scenarioName: 'Growth',
    revenueMonthly: 3_900_000,
    status: 'DRAFT',
  });
}

interface SeedScheduleInstallment {
  installmentNumber: number;
  dueDate: Date;
  openingPrincipal: number;
  principalDue: number;
  interestDue: number;
  totalDue: number;
  closingPrincipal: number;
}

/** Mirrors the real `generateSchedule()` (apps/api/src/finance/debt/
 *  repayment-schedule.ts) — never imported from `src/`, hand-rolled the same
 *  way every other seed fixture in this file mirrors its real service's
 *  shape (see `generateSeedChildAccountCode`'s own doc comment). Only the
 *  AMORTISING/MONTHLY/no-grace path is exercised by seed data, but the full
 *  formula is reproduced so the seeded schedule matches the real engine
 *  exactly, not an approximation. */
function generateSeedRepaymentSchedule(params: {
  principalAmount: number;
  interestRatePercent: number;
  tenorMonths: number;
  graceMonths: number;
  repaymentMethod: 'AMORTISING' | 'INTEREST_ONLY' | 'BULLET';
  startDate: Date;
}): SeedScheduleInstallment[] {
  const roundCurrency = (value: number) => Math.round(value * 100) / 100;
  // UTC-anchored (matches every date literal in this file, `new Date('YYYY-MM-DD')`
  // — using local-timezone month arithmetic here would silently shift the computed
  // due dates by a day on any machine not in UTC, since accounting-period boundaries
  // are themselves UTC-anchored).
  const addMonths = (date: Date, months: number) =>
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));

  const periodRate = params.interestRatePercent / 100 / 12;
  const totalPeriods = params.tenorMonths;
  const gracePeriods = params.graceMonths;
  const repaymentPeriods = totalPeriods - gracePeriods;

  const installments: SeedScheduleInstallment[] = [];
  let openingPrincipal = params.principalAmount;

  for (let i = 1; i <= gracePeriods; i++) {
    const interestDue = roundCurrency(openingPrincipal * periodRate);
    installments.push({
      installmentNumber: i,
      dueDate: addMonths(params.startDate, i),
      openingPrincipal: roundCurrency(openingPrincipal),
      principalDue: 0,
      interestDue,
      totalDue: interestDue,
      closingPrincipal: roundCurrency(openingPrincipal),
    });
  }

  const annuityPayment =
    params.repaymentMethod === 'AMORTISING' && repaymentPeriods > 0
      ? periodRate === 0
        ? openingPrincipal / repaymentPeriods
        : (openingPrincipal * periodRate) / (1 - Math.pow(1 + periodRate, -repaymentPeriods))
      : 0;

  for (let i = 1; i <= repaymentPeriods; i++) {
    const installmentNumber = gracePeriods + i;
    const isLast = i === repaymentPeriods;
    const interestDue = roundCurrency(openingPrincipal * periodRate);

    let principalDue: number;
    if (params.repaymentMethod === 'BULLET' || params.repaymentMethod === 'INTEREST_ONLY') {
      principalDue = isLast ? openingPrincipal : 0;
    } else {
      principalDue = isLast ? openingPrincipal : roundCurrency(annuityPayment - interestDue);
    }
    principalDue = roundCurrency(Math.max(0, Math.min(principalDue, openingPrincipal)));

    const closingPrincipal = roundCurrency(openingPrincipal - principalDue);
    installments.push({
      installmentNumber,
      dueDate: addMonths(params.startDate, installmentNumber),
      openingPrincipal: roundCurrency(openingPrincipal),
      principalDue,
      interestDue,
      totalDue: roundCurrency(principalDue + interestDue),
      closingPrincipal,
    });
    openingPrincipal = closingPrincipal;
  }

  return installments;
}

/** Sprint 17 — Capital & Debt Management Foundation (docs/domains/
 *  debt-management.md). Idempotency-gated on the "Packaging Machine
 *  Expansion" `CapitalRequirement` already existing. Reuses
 *  `generateSeedRepaymentSchedule()` (hand-rolled mirror above) so the seeded
 *  schedule matches what the real API's `generateSchedule()` would produce,
 *  never a hand-typed approximation. */
async function seedDebtManagementFixtures(
  organisationId: string,
  actorUserId: string,
): Promise<void> {
  console.log('Seeding Capital & Debt Management fixtures...');

  const existing = await prisma.capitalRequirement.findFirst({
    where: { organisationId, title: 'Packaging Machine Expansion' },
  });
  if (existing) {
    return;
  }

  // --- Two ordinary, non-system Chart of Accounts rows the facility posts
  // against — the Sprint 12 "Path B" pattern (docs/domains/debt-management.md
  // §3) — never a new SYSTEM_ACCOUNT_KEYS entry.
  const liabilitiesParent = await prisma.chartOfAccount.findFirstOrThrow({
    where: { organisationId, code: '2000' },
  });
  let loansPayable = await prisma.chartOfAccount.findFirst({
    where: { organisationId, code: '2200' },
  });
  if (!loansPayable) {
    loansPayable = await prisma.chartOfAccount.create({
      data: {
        organisationId,
        code: '2200',
        name: 'Loans Payable — Bank',
        type: 'LIABILITY',
        parentId: liabilitiesParent.id,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    });
  }
  const expensesParent = await prisma.chartOfAccount.findFirstOrThrow({
    where: { organisationId, code: '6000' },
  });
  let interestExpense = await prisma.chartOfAccount.findFirst({
    where: { organisationId, code: '6800' },
  });
  if (!interestExpense) {
    interestExpense = await prisma.chartOfAccount.create({
      data: {
        organisationId,
        code: '6800',
        name: 'Interest Expense',
        type: 'EXPENSE',
        parentId: expensesParent.id,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    });
  }

  // --- Lender.
  const gtBankLender = await prisma.lender.create({
    data: {
      organisationId,
      name: 'GTBank',
      type: 'BANK',
      contactName: 'Business Banking Desk',
      createdById: actorUserId,
    },
  });

  // --- Capital Requirement — the structured business reason for financing,
  // linked to Sprint 16's own seeded CAPEX budget line ("New Packaging
  // Machine", ₦8,000,000) so Budget Coverage is a real, demonstrable,
  // sub-100% figure rather than a fabricated one.
  const opsBudget = await prisma.budget.findFirst({
    where: { organisationId, budgetCode: 'BUD-2026-OPS', scenarioName: 'Base' },
  });
  const packagingMachineLine = opsBudget
    ? await prisma.budgetLine.findFirst({
        where: { budgetId: opsBudget.id, lineType: 'CAPEX', description: 'New Packaging Machine' },
      })
    : null;

  const capitalRequirement = await prisma.capitalRequirement.create({
    data: {
      organisationId,
      title: 'Packaging Machine Expansion',
      description: 'A new packaging line to increase finished-goods throughput.',
      requiredAmount: 60_000_000,
      requiredDate: new Date('2026-07-01'),
      type: 'EQUIPMENT',
      status: 'APPROVED',
      priority: 'HIGH',
      budgetId: opsBudget?.id,
      budgetLineId: packagingMachineLine?.id,
      approvedById: actorUserId,
      approvedAt: new Date('2026-06-15'),
      createdById: actorUserId,
    },
  });

  // --- Debt Facility — ₦60,000,000, 20% annual, 24-month amortising,
  // monthly, drawn in full on 1 July 2026. The schedule is generated the
  // same way the real API generates it — at facility-creation time, from
  // `principalAmount` (docs/domains/debt-management.md §6).
  const startDate = new Date('2026-07-01');
  const tenorMonths = 24;
  const interestRatePercent = 20;
  const maturityDate = new Date(
    Date.UTC(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth() + tenorMonths,
      startDate.getUTCDate(),
    ),
  );

  const debtFacility = await prisma.debtFacility.create({
    data: {
      organisationId,
      facilityCode: 'DEBT-000001',
      lenderId: gtBankLender.id,
      name: 'Bank Equipment Loan',
      debtType: 'TERM_LOAN',
      principalAmount: 60_000_000,
      currency: 'NGN',
      interestRatePercent,
      interestType: 'FIXED',
      repaymentMethod: 'AMORTISING',
      repaymentFrequency: 'MONTHLY',
      startDate,
      tenorMonths,
      graceMonths: 0,
      maturityDate,
      status: 'APPROVED',
      liabilityAccountId: loansPayable.id,
      interestExpenseAccountId: interestExpense.id,
      capitalRequirementId: capitalRequirement.id,
      approvedById: actorUserId,
      approvedAt: new Date('2026-06-20'),
      createdById: actorUserId,
    },
  });

  const installments = generateSeedRepaymentSchedule({
    principalAmount: 60_000_000,
    interestRatePercent,
    tenorMonths,
    graceMonths: 0,
    repaymentMethod: 'AMORTISING',
    startDate,
  });
  await prisma.debtRepaymentSchedule.createMany({
    data: installments.map((installment) => ({
      debtFacilityId: debtFacility.id,
      installmentNumber: installment.installmentNumber,
      dueDate: installment.dueDate,
      openingPrincipal: installment.openingPrincipal,
      principalDue: installment.principalDue,
      interestDue: installment.interestDue,
      totalDue: installment.totalDue,
      closingPrincipal: installment.closingPrincipal,
    })),
  });

  // --- Drawdown — the full facility, into the existing GTBank Cash Account
  // (Sprint 14). Posts DR <GTBank's own CoA> / CR Loans Payable.
  //
  // Dated into August 2026 rather than the facility's own July 2026
  // `startDate`: `seedFinance()` (run earlier in `main()`) deliberately
  // closes the "July 2026" `AccountingPeriod` to seed a closed-period
  // fixture, leaving "August 2026" the only OPEN period. A facility's
  // nominal start date is independent of when funds are actually drawn
  // (brief's own Approved-vs-Drawn distinction) — a one-month-delayed
  // drawdown is realistic, not a workaround.
  const gtBankCashAccount = await prisma.cashAccount.findFirstOrThrow({
    where: { organisationId, name: 'GTBank Current Account' },
  });
  const drawdownDate = new Date('2026-08-01');
  const drawdown = await prisma.debtDrawdown.create({
    data: {
      organisationId,
      debtFacilityId: debtFacility.id,
      cashAccountId: gtBankCashAccount.id,
      amount: 60_000_000,
      drawdownDate,
      reference: 'GTBank Equipment Loan Disbursement',
      createdById: actorUserId,
    },
  });
  await postSeedJournalEntry(organisationId, {
    date: drawdownDate,
    description: `Loan drawdown — ${debtFacility.name} (${debtFacility.facilityCode})`,
    sourceType: 'DEBT_DRAWDOWN',
    sourceId: drawdown.id,
    actorUserId,
    lines: [
      { accountId: gtBankCashAccount.linkedChartOfAccountId, debit: 60_000_000 },
      { accountId: loansPayable.id, credit: 60_000_000 },
    ],
  });
  await prisma.debtFacility.update({
    where: { id: debtFacility.id },
    data: { status: 'ACTIVE', activatedAt: drawdownDate },
  });

  // --- One repayment — the first installment (due 2026-08-01, also within
  // the open August period), paid in full, leaving 23 installments and a
  // real outstanding balance (brief §39: "remaining outstanding balance").
  const firstInstallment = installments[0]!;
  const repaymentDate = new Date('2026-08-20');
  const repayment = await prisma.debtRepayment.create({
    data: {
      organisationId,
      debtFacilityId: debtFacility.id,
      cashAccountId: gtBankCashAccount.id,
      paymentDate: repaymentDate,
      principalAmount: firstInstallment.principalDue,
      interestAmount: firstInstallment.interestDue,
      feeAmount: 0,
      totalAmount: firstInstallment.totalDue,
      reference: 'Installment 1 of 24',
      createdById: actorUserId,
    },
  });
  await postSeedJournalEntry(organisationId, {
    date: repaymentDate,
    description: `Loan repayment — ${debtFacility.name} (${debtFacility.facilityCode})`,
    sourceType: 'DEBT_REPAYMENT',
    sourceId: repayment.id,
    actorUserId,
    lines: [
      { accountId: loansPayable.id, debit: firstInstallment.principalDue },
      { accountId: interestExpense.id, debit: firstInstallment.interestDue },
      { accountId: gtBankCashAccount.linkedChartOfAccountId, credit: firstInstallment.totalDue },
    ],
  });
  await prisma.debtRepaymentSchedule.updateMany({
    where: { debtFacilityId: debtFacility.id, installmentNumber: 1 },
    data: { amountPaid: firstInstallment.totalDue, status: 'PAID' },
  });
  await prisma.debtFacility.update({
    where: { id: debtFacility.id },
    data: { status: 'PARTIALLY_REPAID' },
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
    // Sprint 6 — every financial record snapshots `Organisation.currency` at creation
    // time, so it must be deterministically NGN for this Nigerian manufacturer. Set on
    // `update` too (not just `create`) so re-seeding an already-existing organisation
    // (`Organisation.currency` defaults to `"USD"` at the schema level) is corrected
    // rather than silently left on the default.
    update: { currency: 'NGN' },
    create: {
      name: 'Boby Bites',
      slug: BOBY_BITES_SLUG,
      organisationCode: BOBY_BITES_ORGANISATION_CODE,
      businessEmail: adminEmail,
      country: 'Nigeria',
      status: 'ACTIVE',
      currency: 'NGN',
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
  // Sprint 8 — moved ahead of `seedPurchaseOrders`/`seedGoodsReceipts` (previously ran
  // much later, alongside `seedFinance`): `seedGoodsReceipts` now posts a Journal Entry
  // per receipt via `postSeedJournalEntry`, which needs the Chart of Accounts/
  // Accounting Periods to already exist. Neither function depends on anything seeded
  // between the old and new call sites, so this reorder is safe.
  await seedChartOfAccounts(organisation.id, ownerUser.id);
  await seedGrniPendingApprovalAccount(organisation.id, ownerUser.id);
  await seedProductionAccountingAccounts(organisation.id, ownerUser.id);
  await seedAccountingPeriods(organisation.id, ownerUser.id);
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
  await seedPlantain500gProduction(organisation.id, ownerUser.id, productsByCode, mainWarehouseId);

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
  await seedFinanceStockTopUp(organisation.id, ownerUser.id, productsByCode, mainWarehouseId);
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
  // Sprint 8 — `seedChartOfAccounts`/`seedAccountingPeriods` now run earlier (see
  // above, ahead of `seedGoodsReceipts`); not re-called here since both are already
  // idempotency-gated no-ops by this point.
  await seedFinance(
    organisation.id,
    ownerUser.id,
    salesOrdersByCode,
    customersByCode,
    productsByCode,
  );
  await seedCashAndBank(organisation.id, ownerUser.id);
  await seedCashflowFixtures(organisation.id, ownerUser.id);
  await seedBudgetingFixtures(organisation.id, ownerUser.id);
  await seedDebtManagementFixtures(organisation.id, ownerUser.id);

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
    billsOfMaterialSeeded: 3,
    productionOrdersSeeded: 3,
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
    invoicesSeeded: 4,
    paymentsSeeded: 3,
    creditNotesSeeded: 1,
    chartOfAccountsSeeded: BOBY_BITES_CHART_OF_ACCOUNTS.length,
    accountingPeriodsSeeded: 2,
    // 8 from Finance's Invoice/Payment/Credit-Note fixtures (Sprint 7) + one per
    // seeded Goods Receipt (Sprint 8) + 3 from PROD-000001's own posting (Sprint 9:
    // two Material Issues + one Production Completion) + 2 from PROD-000006's own
    // posting (Sprint 10: one Material Issue + one Production Completion, giving
    // PRD-000027 a real cost basis) + one per seeded Sales Fulfilment (Sprint 10 —
    // every entry in BOBY_BITES_SALES_FULFILMENTS includes PRD-000027, which now has
    // a non-zero average cost, so every one posts a COGS journal).
    journalEntriesSeeded:
      8 + BOBY_BITES_GOODS_RECEIPTS.length + 3 + 2 + BOBY_BITES_SALES_FULFILMENTS.length,
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
