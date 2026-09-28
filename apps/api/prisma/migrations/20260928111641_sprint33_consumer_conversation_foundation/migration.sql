-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('WHATSAPP');

-- CreateEnum
CREATE TYPE "ConversationState" AS ENUM ('NEW', 'REGISTRATION', 'LOCATION_SELECTION', 'MAIN_MENU', 'ACTIVE');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "ConversationMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateTable
CREATE TABLE "d2c_consumer_conversations" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "consumerId" TEXT,
    "channel" "ConversationChannel" NOT NULL DEFAULT 'WHATSAPP',
    "externalConversationId" TEXT NOT NULL,
    "state" "ConversationState" NOT NULL DEFAULT 'NEW',
    "context" JSONB,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastInteractionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "d2c_consumer_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "d2c_conversation_messages" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "ConversationMessageDirection" NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "d2c_conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "d2c_consumer_conversations_organisationId_idx" ON "d2c_consumer_conversations"("organisationId");

-- CreateIndex
CREATE INDEX "d2c_consumer_conversations_organisationId_status_idx" ON "d2c_consumer_conversations"("organisationId", "status");

-- CreateIndex
CREATE INDEX "d2c_consumer_conversations_consumerId_idx" ON "d2c_consumer_conversations"("consumerId");

-- CreateIndex
CREATE UNIQUE INDEX "d2c_consumer_conversations_organisationId_channel_externalC_key" ON "d2c_consumer_conversations"("organisationId", "channel", "externalConversationId");

-- CreateIndex
CREATE INDEX "d2c_conversation_messages_organisationId_idx" ON "d2c_conversation_messages"("organisationId");

-- CreateIndex
CREATE INDEX "d2c_conversation_messages_conversationId_idx" ON "d2c_conversation_messages"("conversationId");

-- AddForeignKey
ALTER TABLE "d2c_consumer_conversations" ADD CONSTRAINT "d2c_consumer_conversations_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "d2c_consumer_conversations" ADD CONSTRAINT "d2c_consumer_conversations_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES "d2c_consumers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "d2c_conversation_messages" ADD CONSTRAINT "d2c_conversation_messages_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "d2c_conversation_messages" ADD CONSTRAINT "d2c_conversation_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "d2c_consumer_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

