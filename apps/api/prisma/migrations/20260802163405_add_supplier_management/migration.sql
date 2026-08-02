-- CreateEnum
CREATE TYPE "SupplierCategory" AS ENUM ('RAW_MATERIAL', 'PACKAGING', 'LOGISTICS', 'MAINTENANCE', 'UTILITY', 'SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "supplierCode" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "displayName" TEXT,
    "contactPerson" TEXT,
    "email" TEXT,
    "phoneNumber" TEXT,
    "website" TEXT,
    "country" TEXT,
    "state" TEXT,
    "city" TEXT,
    "address" TEXT,
    "taxIdentificationNumber" TEXT,
    "supplierCategory" "SupplierCategory" NOT NULL,
    "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_supplierCode_key" ON "suppliers"("supplierCode");

-- CreateIndex
CREATE INDEX "suppliers_organisationId_idx" ON "suppliers"("organisationId");

-- CreateIndex
CREATE INDEX "suppliers_organisationId_status_idx" ON "suppliers"("organisationId", "status");

-- CreateIndex
CREATE INDEX "suppliers_organisationId_supplierCategory_idx" ON "suppliers"("organisationId", "supplierCategory");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
