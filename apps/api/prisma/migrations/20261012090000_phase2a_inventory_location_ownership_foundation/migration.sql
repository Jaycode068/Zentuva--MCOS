-- Phase 2A — Customer-Location Inventory Foundation
-- (docs/customer-location-inventory-architecture-audit.md §5/§7)
--
-- Purely additive: three new enums, one new enum value, four new nullable-or-
-- safely-defaulted columns, one new index, one new foreign key, one new CHECK
-- constraint. No existing column is altered or dropped. No existing row's
-- quantityOnHand/averageUnitCost/locationId/organisationId changes. Every
-- existing InventoryLocation row becomes locationType='WAREHOUSE' (definitionally
-- correct — no other kind of location existed before this migration). Every
-- existing InventoryStock row becomes ownership='ORGANISATION',
-- arrangement='WHOLESALE' (also definitionally correct under the prior
-- architecture). No Outlet.inventoryLocationId value is touched.

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('WAREHOUSE', 'CUSTOMER_LOCATION');

-- CreateEnum
CREATE TYPE "StockOwnership" AS ENUM ('ORGANISATION', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "StockArrangement" AS ENUM ('WHOLESALE', 'CONSIGNMENT', 'D2C_COLLECTION_POINT');

-- AlterEnum
ALTER TYPE "InventoryTransactionType" ADD VALUE 'TRANSFER';

-- AlterTable
ALTER TABLE "inventory_locations" ADD COLUMN     "locationType" "LocationType" NOT NULL DEFAULT 'WAREHOUSE',
ADD COLUMN     "outletId" TEXT;

-- AlterTable
ALTER TABLE "inventory_stock" ADD COLUMN     "arrangement" "StockArrangement" NOT NULL DEFAULT 'WHOLESALE',
ADD COLUMN     "ownership" "StockOwnership" NOT NULL DEFAULT 'ORGANISATION';

-- CreateIndex
CREATE INDEX "inventory_locations_outletId_idx" ON "inventory_locations"("outletId");

-- AddForeignKey
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "outlets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Defense-in-depth, matching the Phase 1 Customer.creditLimit precedent: enforce the
-- documented mutual-exclusion/required-pairing rule at the database level too, not
-- just in InventoryService (docs/customer-location-inventory-architecture-audit.md
-- §7 "document and enforce the valid combinations"). A WAREHOUSE location must never
-- carry an outlet association; a CUSTOMER_LOCATION must always have one (otherwise
-- it represents no identifiable physical place).
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_type_outlet_consistency"
  CHECK (
    ("locationType" = 'WAREHOUSE' AND "outletId" IS NULL) OR
    ("locationType" = 'CUSTOMER_LOCATION' AND "outletId" IS NOT NULL)
  );
