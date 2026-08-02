-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('SNACKS', 'BEVERAGE', 'WATER', 'CONFECTIONERY', 'RAW_MATERIALS', 'PACKAGING', 'OTHERS');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('FINISHED_PRODUCT', 'RAW_MATERIAL', 'PACKAGING_MATERIAL');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "slug" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "type" "ProductType" NOT NULL,
    "shortDescription" TEXT,
    "longDescription" TEXT,
    "unit" TEXT NOT NULL,
    "imageUrl" TEXT,
    "imageKey" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE INDEX "products_organisationId_idx" ON "products"("organisationId");

-- CreateIndex
CREATE INDEX "products_organisationId_status_idx" ON "products"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "products_organisationId_slug_key" ON "products"("organisationId", "slug");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
