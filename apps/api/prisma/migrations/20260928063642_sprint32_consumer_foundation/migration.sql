-- CreateEnum
CREATE TYPE "ConsumerStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');

-- CreateTable
CREATE TABLE "d2c_consumers" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "consumerCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "normalizedPhone" TEXT NOT NULL,
    "email" TEXT,
    "status" "ConsumerStatus" NOT NULL DEFAULT 'ACTIVE',
    "territoryId" TEXT,
    "address" TEXT,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "d2c_consumers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "d2c_consumer_location_requests" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "consumerId" TEXT NOT NULL,
    "rawLocationText" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "d2c_consumer_location_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "d2c_consumers_consumerCode_key" ON "d2c_consumers"("consumerCode");

-- CreateIndex
CREATE INDEX "d2c_consumers_organisationId_idx" ON "d2c_consumers"("organisationId");

-- CreateIndex
CREATE INDEX "d2c_consumers_organisationId_status_idx" ON "d2c_consumers"("organisationId", "status");

-- CreateIndex
CREATE INDEX "d2c_consumers_territoryId_idx" ON "d2c_consumers"("territoryId");

-- CreateIndex
CREATE UNIQUE INDEX "d2c_consumers_organisationId_normalizedPhone_key" ON "d2c_consumers"("organisationId", "normalizedPhone");

-- CreateIndex
CREATE INDEX "d2c_consumer_location_requests_organisationId_idx" ON "d2c_consumer_location_requests"("organisationId");

-- CreateIndex
CREATE INDEX "d2c_consumer_location_requests_organisationId_resolvedAt_idx" ON "d2c_consumer_location_requests"("organisationId", "resolvedAt");

-- CreateIndex
CREATE INDEX "d2c_consumer_location_requests_consumerId_idx" ON "d2c_consumer_location_requests"("consumerId");

-- AddForeignKey
ALTER TABLE "d2c_consumers" ADD CONSTRAINT "d2c_consumers_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "d2c_consumers" ADD CONSTRAINT "d2c_consumers_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "territories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "d2c_consumer_location_requests" ADD CONSTRAINT "d2c_consumer_location_requests_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "d2c_consumer_location_requests" ADD CONSTRAINT "d2c_consumer_location_requests_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES "d2c_consumers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

