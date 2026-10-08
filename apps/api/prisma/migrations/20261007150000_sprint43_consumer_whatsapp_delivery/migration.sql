-- CreateEnum
CREATE TYPE "ConsumerWhatsAppNotificationKind" AS ENUM ('COLLECTION_READY', 'COLLECTION_CONFIRMED');

-- CreateTable
CREATE TABLE "consumer_whatsapp_deliveries" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "consumerId" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "kind" "ConsumerWhatsAppNotificationKind" NOT NULL,
    "recipientPhoneSnapshot" TEXT NOT NULL,
    "messageSnapshot" TEXT NOT NULL,
    "status" "WhatsAppDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerName" TEXT,
    "providerMessageId" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "firstAttemptedAt" TIMESTAMP(3),
    "lastAttemptedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consumer_whatsapp_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consumer_whatsapp_deliveries_organisationId_consumerId_idx" ON "consumer_whatsapp_deliveries"("organisationId", "consumerId");

-- CreateIndex
CREATE INDEX "consumer_whatsapp_deliveries_organisationId_salesOrderId_idx" ON "consumer_whatsapp_deliveries"("organisationId", "salesOrderId");

-- CreateIndex
CREATE INDEX "consumer_whatsapp_deliveries_organisationId_status_idx" ON "consumer_whatsapp_deliveries"("organisationId", "status");

-- CreateIndex
CREATE INDEX "consumer_whatsapp_deliveries_organisationId_createdAt_idx" ON "consumer_whatsapp_deliveries"("organisationId", "createdAt");

-- AddForeignKey
ALTER TABLE "consumer_whatsapp_deliveries" ADD CONSTRAINT "consumer_whatsapp_deliveries_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_whatsapp_deliveries" ADD CONSTRAINT "consumer_whatsapp_deliveries_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES "d2c_consumers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_whatsapp_deliveries" ADD CONSTRAINT "consumer_whatsapp_deliveries_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

