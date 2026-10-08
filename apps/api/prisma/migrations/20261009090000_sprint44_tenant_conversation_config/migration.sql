-- CreateEnum
CREATE TYPE "D2CConversationCapability" AS ENUM ('ORDER_SNACKS', 'MY_ORDERS', 'MY_REWARDS', 'MY_ACCOUNT', 'UPDATE_LOCATION', 'HELP');

-- CreateEnum
CREATE TYPE "D2CConversationMessageKey" AS ENUM ('WELCOME', 'MAIN_MENU_PROMPT', 'HELP', 'UNKNOWN_COMMAND', 'ASK_NAME', 'REGISTRATION_COMPLETE', 'LOCATION_UPDATED', 'ASK_QUANTITY', 'ORDER_CREATED', 'PAYMENT_SUCCESS', 'MY_ORDERS_EMPTY', 'READY_FOR_COLLECTION', 'COLLECTION_CONFIRMED', 'ORDER_CANCELLED');

-- CreateTable
CREATE TABLE "d2c_conversation_capability_configs" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "capability" "D2CConversationCapability" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "displayLabel" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "d2c_conversation_capability_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "d2c_conversation_message_configs" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "messageKey" "D2CConversationMessageKey" NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "d2c_conversation_message_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "d2c_conversation_profiles" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "supportPhoneOverride" TEXT,
    "supportEmailOverride" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "d2c_conversation_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "d2c_conversation_capability_configs_organisationId_idx" ON "d2c_conversation_capability_configs"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "d2c_conversation_capability_configs_organisationId_capabili_key" ON "d2c_conversation_capability_configs"("organisationId", "capability");

-- CreateIndex
CREATE INDEX "d2c_conversation_message_configs_organisationId_idx" ON "d2c_conversation_message_configs"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "d2c_conversation_message_configs_organisationId_messageKey_key" ON "d2c_conversation_message_configs"("organisationId", "messageKey");

-- CreateIndex
CREATE UNIQUE INDEX "d2c_conversation_profiles_organisationId_key" ON "d2c_conversation_profiles"("organisationId");

-- AddForeignKey
ALTER TABLE "d2c_conversation_capability_configs" ADD CONSTRAINT "d2c_conversation_capability_configs_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "d2c_conversation_message_configs" ADD CONSTRAINT "d2c_conversation_message_configs_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "d2c_conversation_profiles" ADD CONSTRAINT "d2c_conversation_profiles_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

