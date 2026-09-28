-- CreateEnum
CREATE TYPE "SalesOrderSource" AS ENUM ('B2B', 'D2C');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "sellingPrice" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN     "consumerId" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "source" "SalesOrderSource" NOT NULL DEFAULT 'B2B',
ALTER COLUMN "customerId" DROP NOT NULL,
ALTER COLUMN "salesAgentId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "sales_orders_organisationId_consumerId_idx" ON "sales_orders"("organisationId", "consumerId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_organisationId_idempotencyKey_key" ON "sales_orders"("organisationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES "d2c_consumers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraint (Sprint 34 — docs/domains/d2c.md "Consumer -> SalesOrder Relationship")
-- Not expressible in Prisma's schema DSL (no multi-column CHECK support), added by hand:
-- exactly one of customerId (B2B)/consumerId (D2C) must be set, never both, never neither.
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_xor_consumer_check"
  CHECK (
    ("customerId" IS NOT NULL AND "consumerId" IS NULL)
    OR
    ("customerId" IS NULL AND "consumerId" IS NOT NULL)
  );

