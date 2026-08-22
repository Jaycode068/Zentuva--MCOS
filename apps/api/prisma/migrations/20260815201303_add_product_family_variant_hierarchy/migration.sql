-- CreateEnum
CREATE TYPE "ProductFamilyStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ProductVariantStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "productVariantId" TEXT;

-- CreateTable
CREATE TABLE "product_families" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProductFamilyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "productFamilyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProductVariantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_families_code_key" ON "product_families"("code");

-- CreateIndex
CREATE INDEX "product_families_organisationId_idx" ON "product_families"("organisationId");

-- CreateIndex
CREATE INDEX "product_families_organisationId_status_idx" ON "product_families"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_code_key" ON "product_variants"("code");

-- CreateIndex
CREATE INDEX "product_variants_organisationId_idx" ON "product_variants"("organisationId");

-- CreateIndex
CREATE INDEX "product_variants_organisationId_status_idx" ON "product_variants"("organisationId", "status");

-- CreateIndex
CREATE INDEX "product_variants_productFamilyId_idx" ON "product_variants"("productFamilyId");

-- CreateIndex
CREATE INDEX "products_productVariantId_idx" ON "products"("productVariantId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_families" ADD CONSTRAINT "product_families_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productFamilyId_fkey" FOREIGN KEY ("productFamilyId") REFERENCES "product_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
