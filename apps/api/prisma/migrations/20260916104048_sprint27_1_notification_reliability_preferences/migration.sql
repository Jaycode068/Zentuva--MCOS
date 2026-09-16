-- CreateEnum
CREATE TYPE "NotificationProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('WORKFLOW_APPROVALS', 'WORKFLOW_STATUS_CHANGES');

-- DropIndex
DROP INDEX "workflow_events_organisationId_notificationProcessedAt_idx";

-- AlterTable
ALTER TABLE "workflow_events" ADD COLUMN     "notificationLastErrorCategory" TEXT,
ADD COLUMN     "notificationLeaseAt" TIMESTAMP(3),
ADD COLUMN     "notificationNextRetryAt" TIMESTAMP(3),
ADD COLUMN     "notificationProcessingStatus" "NotificationProcessingStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_preferences_organisationId_userId_idx" ON "notification_preferences"("organisationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_organisationId_userId_category_key" ON "notification_preferences"("organisationId", "userId", "category");

-- CreateIndex
CREATE INDEX "workflow_events_organisationId_notificationProcessingStatus_idx" ON "workflow_events"("organisationId", "notificationProcessingStatus", "notificationNextRetryAt");

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sprint 27.1 hand-added backfill: existing "workflow_events" rows predate the new
-- authoritative notificationProcessingStatus state machine and default to PENDING
-- (the column default) regardless of their actual history. Correct that for rows
-- that already finished successfully under Sprint 27's old nullable-timestamp
-- model, so they are never re-selected by the new claim query.
UPDATE "workflow_events"
SET "notificationProcessingStatus" = 'PROCESSED'
WHERE "notificationProcessedAt" IS NOT NULL;

-- Any row that was attempted at least once but never reached notificationProcessedAt
-- (an attempt was in flight or failed under the OLD model, which had no PROCESSING/
-- FAILED distinction) is left PENDING with an immediately-due retry, rather than
-- silently PROCESSED — safe because reprocessing is idempotent (the Notification
-- unique constraint), and honest because the old model cannot tell us whether it
-- actually succeeded.
UPDATE "workflow_events"
SET "notificationNextRetryAt" = CURRENT_TIMESTAMP
WHERE "notificationProcessedAt" IS NULL AND "notificationAttempts" > 0;
