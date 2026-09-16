-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('UNREAD', 'READ');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('WORKFLOW_APPROVAL_REQUIRED', 'WORKFLOW_STEP_APPROVED', 'WORKFLOW_APPROVED', 'WORKFLOW_STEP_REJECTED', 'WORKFLOW_RETURNED', 'WORKFLOW_RESUBMITTED', 'WORKFLOW_CANCELLED', 'WORKFLOW_EXPIRED');

-- AlterTable
ALTER TABLE "workflow_events" ADD COLUMN     "notificationAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "notificationLastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "notificationLastError" TEXT,
ADD COLUMN     "notificationProcessedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'UNREAD',
    "readAt" TIMESTAMP(3),
    "sourceEventId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "actionUrl" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_organisationId_recipientUserId_status_idx" ON "notifications"("organisationId", "recipientUserId", "status");

-- CreateIndex
CREATE INDEX "notifications_organisationId_recipientUserId_createdAt_idx" ON "notifications"("organisationId", "recipientUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_organisationId_sourceEventId_recipientUserId__key" ON "notifications"("organisationId", "sourceEventId", "recipientUserId", "channel");

-- CreateIndex
CREATE INDEX "workflow_events_organisationId_notificationProcessedAt_idx" ON "workflow_events"("organisationId", "notificationProcessedAt");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_sourceEventId_fkey" FOREIGN KEY ("sourceEventId") REFERENCES "workflow_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
