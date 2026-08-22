-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('DISTRIBUTOR', 'WHOLESALER', 'RETAILER', 'SUPERMARKET', 'CORPORATE', 'INSTITUTION', 'RESTAURANT', 'HOTEL', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "OutletType" AS ENUM ('SUPERMARKET', 'HYPERMARKET', 'WHOLESALE_STORE', 'RETAIL_SHOP', 'KIOSK', 'MARKET_STALL', 'DISTRIBUTOR_WAREHOUSE', 'WHOLESALER_WAREHOUSE', 'CONVENIENCE_STORE', 'RESTAURANT', 'HOTEL', 'CORPORATE', 'INSTITUTION', 'OTHER');

-- CreateEnum
CREATE TYPE "OutletStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TerritoryStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "OutletPhotoType" AS ENUM ('FRONT', 'SIGNAGE', 'INTERIOR', 'SHELF_DISPLAY', 'OTHER');

-- CreateEnum
CREATE TYPE "DistributionRelationshipType" AS ENUM ('DISTRIBUTES_TO', 'WHOLESALES_TO', 'SUPPLIES', 'OTHER');

-- CreateEnum
CREATE TYPE "NetworkRelationshipStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "territories" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "territoryCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "parentTerritoryId" TEXT,
    "status" "TerritoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "territories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "customerCode" TEXT NOT NULL,
    "customerType" "CustomerType" NOT NULL,
    "customerName" TEXT NOT NULL,
    "contactPersonName" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "alternatePhoneNumber" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "territoryId" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outlets" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "outletCode" TEXT NOT NULL,
    "outletType" "OutletType" NOT NULL,
    "name" TEXT NOT NULL,
    "contactPersonName" TEXT,
    "phoneNumber" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "territoryId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "status" "OutletStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outlets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outlet_photos" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "photoType" "OutletPhotoType",
    "caption" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outlet_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distribution_network_relationships" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "sourceCustomerId" TEXT NOT NULL,
    "targetCustomerId" TEXT NOT NULL,
    "relationshipType" "DistributionRelationshipType" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "status" "NetworkRelationshipStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distribution_network_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "orderCode" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "outletId" TEXT,
    "salesAgentId" TEXT NOT NULL,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "orderDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_items" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "lineTotal" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "territories_territoryCode_key" ON "territories"("territoryCode");

-- CreateIndex
CREATE INDEX "territories_organisationId_idx" ON "territories"("organisationId");

-- CreateIndex
CREATE INDEX "territories_organisationId_status_idx" ON "territories"("organisationId", "status");

-- CreateIndex
CREATE INDEX "territories_parentTerritoryId_idx" ON "territories"("parentTerritoryId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_customerCode_key" ON "customers"("customerCode");

-- CreateIndex
CREATE INDEX "customers_organisationId_idx" ON "customers"("organisationId");

-- CreateIndex
CREATE INDEX "customers_organisationId_status_idx" ON "customers"("organisationId", "status");

-- CreateIndex
CREATE INDEX "customers_organisationId_customerType_idx" ON "customers"("organisationId", "customerType");

-- CreateIndex
CREATE INDEX "customers_territoryId_idx" ON "customers"("territoryId");

-- CreateIndex
CREATE UNIQUE INDEX "outlets_outletCode_key" ON "outlets"("outletCode");

-- CreateIndex
CREATE INDEX "outlets_organisationId_idx" ON "outlets"("organisationId");

-- CreateIndex
CREATE INDEX "outlets_organisationId_status_idx" ON "outlets"("organisationId", "status");

-- CreateIndex
CREATE INDEX "outlets_organisationId_customerId_idx" ON "outlets"("organisationId", "customerId");

-- CreateIndex
CREATE INDEX "outlets_territoryId_idx" ON "outlets"("territoryId");

-- CreateIndex
CREATE INDEX "outlet_photos_organisationId_idx" ON "outlet_photos"("organisationId");

-- CreateIndex
CREATE INDEX "outlet_photos_outletId_idx" ON "outlet_photos"("outletId");

-- CreateIndex
CREATE INDEX "distribution_network_relationships_organisationId_idx" ON "distribution_network_relationships"("organisationId");

-- CreateIndex
CREATE INDEX "distribution_network_relationships_organisationId_status_idx" ON "distribution_network_relationships"("organisationId", "status");

-- CreateIndex
CREATE INDEX "distribution_network_relationships_sourceCustomerId_idx" ON "distribution_network_relationships"("sourceCustomerId");

-- CreateIndex
CREATE INDEX "distribution_network_relationships_targetCustomerId_idx" ON "distribution_network_relationships"("targetCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_orderCode_key" ON "sales_orders"("orderCode");

-- CreateIndex
CREATE INDEX "sales_orders_organisationId_idx" ON "sales_orders"("organisationId");

-- CreateIndex
CREATE INDEX "sales_orders_organisationId_status_idx" ON "sales_orders"("organisationId", "status");

-- CreateIndex
CREATE INDEX "sales_orders_organisationId_customerId_idx" ON "sales_orders"("organisationId", "customerId");

-- CreateIndex
CREATE INDEX "sales_orders_organisationId_orderDate_idx" ON "sales_orders"("organisationId", "orderDate");

-- CreateIndex
CREATE INDEX "sales_orders_outletId_idx" ON "sales_orders"("outletId");

-- CreateIndex
CREATE INDEX "sales_order_items_salesOrderId_idx" ON "sales_order_items"("salesOrderId");

-- CreateIndex
CREATE INDEX "sales_order_items_productId_idx" ON "sales_order_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_items_salesOrderId_productId_key" ON "sales_order_items"("salesOrderId", "productId");

-- AddForeignKey
ALTER TABLE "territories" ADD CONSTRAINT "territories_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territories" ADD CONSTRAINT "territories_parentTerritoryId_fkey" FOREIGN KEY ("parentTerritoryId") REFERENCES "territories"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "territories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "territories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlet_photos" ADD CONSTRAINT "outlet_photos_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlet_photos" ADD CONSTRAINT "outlet_photos_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "outlets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_network_relationships" ADD CONSTRAINT "distribution_network_relationships_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_network_relationships" ADD CONSTRAINT "distribution_network_relationships_sourceCustomerId_fkey" FOREIGN KEY ("sourceCustomerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_network_relationships" ADD CONSTRAINT "distribution_network_relationships_targetCustomerId_fkey" FOREIGN KEY ("targetCustomerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
