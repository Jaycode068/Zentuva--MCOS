-- CreateEnum
CREATE TYPE "AssetCategoryStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AssetLocationStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'IN_SERVICE', 'UNDER_MAINTENANCE', 'OUT_OF_SERVICE', 'DISPOSED', 'RETIRED');

-- CreateEnum
CREATE TYPE "AssetCondition" AS ENUM ('NEW', 'GOOD', 'FAIR', 'POOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AssetAcquisitionType" AS ENUM ('PURCHASE', 'CAPITAL_PROJECT', 'TRANSFER', 'DONATION', 'LEASE', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetDocumentType" AS ENUM ('PHOTO', 'INVOICE', 'WARRANTY_DOCUMENT', 'MANUAL', 'CERTIFICATE', 'REGISTRATION', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetMeterType" AS ENUM ('HOURS', 'KILOMETERS', 'CYCLES', 'UNITS', 'OTHER');

-- CreateTable
CREATE TABLE "asset_categories" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentCategoryId" TEXT,
    "status" "AssetCategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_locations" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentLocationId" TEXT,
    "status" "AssetLocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "assetTag" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT NOT NULL,
    "parentAssetId" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'DRAFT',
    "condition" "AssetCondition" NOT NULL DEFAULT 'NEW',
    "serialNumber" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "yearOfManufacture" INTEGER,
    "locationId" TEXT,
    "custodianId" TEXT,
    "acquisitionType" "AssetAcquisitionType" NOT NULL DEFAULT 'PURCHASE',
    "acquisitionDate" TIMESTAMP(3),
    "inServiceDate" TIMESTAMP(3),
    "acquisitionCost" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "supplierId" TEXT,
    "purchaseOrderId" TEXT,
    "capitalProjectId" TEXT,
    "warrantyStartDate" TIMESTAMP(3),
    "warrantyEndDate" TIMESTAMP(3),
    "warrantyProvider" TEXT,
    "warrantyReference" TEXT,
    "warrantyNotes" TEXT,
    "usefulLifeMonths" INTEGER,
    "salvageValue" DOUBLE PRECISION,
    "notes" TEXT,
    "imageUrl" TEXT,
    "imageKey" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "activatedAt" TIMESTAMP(3),
    "commissionedAt" TIMESTAMP(3),
    "disposedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_documents" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "documentType" "AssetDocumentType" NOT NULL,
    "url" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fileName" TEXT,
    "caption" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_movements" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "previousLocationId" TEXT,
    "newLocationId" TEXT,
    "previousCustodianId" TEXT,
    "newCustodianId" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "performedById" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_meters" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "meterType" "AssetMeterType" NOT NULL,
    "unit" TEXT NOT NULL,
    "currentReading" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastReadingDate" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_meters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_meter_readings" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "reading" DOUBLE PRECISION NOT NULL,
    "readingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_meter_readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_categories_organisationId_status_idx" ON "asset_categories"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "asset_categories_organisationId_code_key" ON "asset_categories"("organisationId", "code");

-- CreateIndex
CREATE INDEX "asset_locations_organisationId_status_idx" ON "asset_locations"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "asset_locations_organisationId_name_key" ON "asset_locations"("organisationId", "name");

-- CreateIndex
CREATE INDEX "assets_organisationId_status_idx" ON "assets"("organisationId", "status");

-- CreateIndex
CREATE INDEX "assets_organisationId_categoryId_idx" ON "assets"("organisationId", "categoryId");

-- CreateIndex
CREATE INDEX "assets_organisationId_locationId_idx" ON "assets"("organisationId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "assets_organisationId_assetCode_key" ON "assets"("organisationId", "assetCode");

-- CreateIndex
CREATE UNIQUE INDEX "assets_organisationId_assetTag_key" ON "assets"("organisationId", "assetTag");

-- CreateIndex
CREATE UNIQUE INDEX "assets_organisationId_idempotencyKey_key" ON "assets"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "asset_documents_organisationId_idx" ON "asset_documents"("organisationId");

-- CreateIndex
CREATE INDEX "asset_documents_assetId_idx" ON "asset_documents"("assetId");

-- CreateIndex
CREATE INDEX "asset_movements_assetId_idx" ON "asset_movements"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_movements_organisationId_idempotencyKey_key" ON "asset_movements"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "asset_meters_assetId_meterType_key" ON "asset_meters"("assetId", "meterType");

-- CreateIndex
CREATE INDEX "asset_meter_readings_meterId_idx" ON "asset_meter_readings"("meterId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_meter_readings_organisationId_idempotencyKey_key" ON "asset_meter_readings"("organisationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_parentCategoryId_fkey" FOREIGN KEY ("parentCategoryId") REFERENCES "asset_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_locations" ADD CONSTRAINT "asset_locations_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_locations" ADD CONSTRAINT "asset_locations_parentLocationId_fkey" FOREIGN KEY ("parentLocationId") REFERENCES "asset_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "asset_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_parentAssetId_fkey" FOREIGN KEY ("parentAssetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "asset_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_capitalProjectId_fkey" FOREIGN KEY ("capitalProjectId") REFERENCES "capital_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_documents" ADD CONSTRAINT "asset_documents_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_documents" ADD CONSTRAINT "asset_documents_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_meters" ADD CONSTRAINT "asset_meters_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_meters" ADD CONSTRAINT "asset_meters_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_meter_readings" ADD CONSTRAINT "asset_meter_readings_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_meter_readings" ADD CONSTRAINT "asset_meter_readings_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "asset_meters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
