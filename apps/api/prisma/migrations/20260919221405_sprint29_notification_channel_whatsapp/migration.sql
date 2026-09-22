-- CreateEnum
CREATE TYPE "WhatsAppDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

-- NotificationChannel.WHATSAPP was added in the preceding migration
-- (20260919221404_sprint29_notification_channel_whatsapp_enum) since Postgres
-- requires a new enum value to be committed before use elsewhere in the same
-- transaction.

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "whatsapp_deliveries" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "recipientPhoneSnapshot" TEXT NOT NULL,
    "recipientDisplayNameSnapshot" TEXT,
    "templateName" TEXT NOT NULL,
    "templateLanguage" TEXT NOT NULL,
    "templateParameterSnapshot" JSONB NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "status" "WhatsAppDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processingStartedAt" TIMESTAMP(3),
    "firstAttemptedAt" TIMESTAMP(3),
    "lastAttemptedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "leaseAt" TIMESTAMP(3),
    "providerName" TEXT,
    "providerMessageId" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'WHATSAPP',

    CONSTRAINT "whatsapp_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_deliveries_organisationId_status_nextRetryAt_idx" ON "whatsapp_deliveries"("organisationId", "status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "whatsapp_deliveries_organisationId_recipientUserId_idx" ON "whatsapp_deliveries"("organisationId", "recipientUserId");

-- CreateIndex
CREATE INDEX "whatsapp_deliveries_organisationId_createdAt_idx" ON "whatsapp_deliveries"("organisationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_deliveries_organisationId_notificationId_channel_key" ON "whatsapp_deliveries"("organisationId", "notificationId", "channel");

-- AddForeignKey
ALTER TABLE "whatsapp_deliveries" ADD CONSTRAINT "whatsapp_deliveries_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_deliveries" ADD CONSTRAINT "whatsapp_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
