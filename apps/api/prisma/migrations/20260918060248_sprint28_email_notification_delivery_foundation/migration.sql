-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

-- NotificationChannel.EMAIL was added in the preceding migration
-- (20260918060247_sprint28_notification_channel_email) since Postgres requires a
-- new enum value to be committed before use elsewhere in the same transaction.

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "emailEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "email_deliveries" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "recipientDisplayName" TEXT,
    "templateKey" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "textBody" TEXT NOT NULL,
    "htmlBody" TEXT,
    "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "firstAttemptedAt" TIMESTAMP(3),
    "lastAttemptedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "leaseAt" TIMESTAMP(3),
    "providerName" TEXT,
    "providerMessageId" TEXT,
    "lastErrorCategory" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL',

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_deliveries_organisationId_status_nextRetryAt_idx" ON "email_deliveries"("organisationId", "status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "email_deliveries_organisationId_recipientUserId_idx" ON "email_deliveries"("organisationId", "recipientUserId");

-- CreateIndex
CREATE INDEX "email_deliveries_organisationId_createdAt_idx" ON "email_deliveries"("organisationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_deliveries_organisationId_notificationId_channel_key" ON "email_deliveries"("organisationId", "notificationId", "channel");

-- AddForeignKey
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
