-- CreateTable
CREATE TABLE "whatsapp_webhook_events" (
    "id" TEXT NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_webhook_events_externalMessageId_key" ON "whatsapp_webhook_events"("externalMessageId");

-- CreateIndex
CREATE INDEX "whatsapp_webhook_events_receivedAt_idx" ON "whatsapp_webhook_events"("receivedAt");

