-- AlterEnum
ALTER TYPE "ConsumerWhatsAppNotificationKind" ADD VALUE 'CONVERSATION_REPLY';

-- AlterTable
ALTER TABLE "consumer_whatsapp_deliveries" ADD COLUMN     "conversationId" TEXT,
ALTER COLUMN "consumerId" DROP NOT NULL,
ALTER COLUMN "salesOrderId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "d2c_conversation_messages" ADD COLUMN     "externalMessageId" TEXT;

-- CreateIndex
CREATE INDEX "consumer_whatsapp_deliveries_organisationId_conversationId_idx" ON "consumer_whatsapp_deliveries"("organisationId", "conversationId");

-- AddForeignKey
ALTER TABLE "consumer_whatsapp_deliveries" ADD CONSTRAINT "consumer_whatsapp_deliveries_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "d2c_consumer_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

