-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('OPAY');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'ONLINE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentStatus" ADD VALUE 'PENDING';
ALTER TYPE "PaymentStatus" ADD VALUE 'FAILED';
ALTER TYPE "PaymentStatus" ADD VALUE 'CLOSED';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "checkoutUrl" TEXT,
ADD COLUMN     "consumerId" TEXT,
ADD COLUMN     "merchantReference" TEXT,
ADD COLUMN     "provider" "PaymentProvider",
ADD COLUMN     "providerReference" TEXT,
ADD COLUMN     "salesOrderId" TEXT,
ALTER COLUMN "customerId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "payments_organisationId_consumerId_idx" ON "payments"("organisationId", "consumerId");

-- CreateIndex
CREATE INDEX "payments_organisationId_salesOrderId_idx" ON "payments"("organisationId", "salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_merchantReference_key" ON "payments"("merchantReference");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES "d2c_consumers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraint (Sprint 35 — docs/domains/d2c.md "Payment Architecture")
-- Not expressible in Prisma's schema DSL (no multi-column CHECK support), added by
-- hand: exactly one of customerId (B2B)/consumerId (D2C) must be set, never both,
-- never neither — the exact SalesOrder precedent from Sprint 34.
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_xor_consumer_check"
  CHECK (
    ("customerId" IS NOT NULL AND "consumerId" IS NULL)
    OR
    ("customerId" IS NULL AND "consumerId" IS NOT NULL)
  );
