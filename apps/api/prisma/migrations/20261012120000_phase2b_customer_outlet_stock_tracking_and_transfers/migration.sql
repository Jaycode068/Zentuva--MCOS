-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('COMPLETED', 'REVERSED');

-- CreateTable
CREATE TABLE "inventory_transfers" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "transferNumber" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sourceLocationId" TEXT NOT NULL,
    "destinationLocationId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "ownership" "StockOwnership" NOT NULL,
    "arrangement" "StockArrangement" NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'COMPLETED',
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "reversalOfTransferId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transfers_transferNumber_key" ON "inventory_transfers"("transferNumber");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transfers_reversalOfTransferId_key" ON "inventory_transfers"("reversalOfTransferId");

-- CreateIndex
CREATE INDEX "inventory_transfers_organisationId_idx" ON "inventory_transfers"("organisationId");

-- CreateIndex
CREATE INDEX "inventory_transfers_organisationId_productId_idx" ON "inventory_transfers"("organisationId", "productId");

-- CreateIndex
CREATE INDEX "inventory_transfers_sourceLocationId_idx" ON "inventory_transfers"("sourceLocationId");

-- CreateIndex
CREATE INDEX "inventory_transfers_destinationLocationId_idx" ON "inventory_transfers"("destinationLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transfers_organisationId_idempotencyKey_key" ON "inventory_transfers"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_locations_outletId_key" ON "inventory_locations"("outletId");

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_reversalOfTransferId_fkey" FOREIGN KEY ("reversalOfTransferId") REFERENCES "inventory_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

