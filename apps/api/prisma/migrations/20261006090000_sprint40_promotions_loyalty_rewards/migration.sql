-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PromotionConditionType" AS ENUM ('FIRST_QUALIFYING_ORDER', 'MINIMUM_ORDER_VALUE', 'PRODUCT_QUANTITY', 'TERRITORY');

-- CreateEnum
CREATE TYPE "PromotionBenefitType" AS ENUM ('BONUS_POINTS', 'FREE_PRODUCT');

-- CreateEnum
CREATE TYPE "RewardGrantStatus" AS ENUM ('GRANTED', 'PENDING_FULFILLMENT');

-- CreateEnum
CREATE TYPE "LoyaltyLedgerEntryType" AS ENUM ('EARN', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "PromotionStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_conditions" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "type" "PromotionConditionType" NOT NULL,
    "minOrderValue" DOUBLE PRECISION,
    "productId" TEXT,
    "minQuantity" INTEGER,
    "territoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_benefits" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "type" "PromotionBenefitType" NOT NULL,
    "pointsValue" INTEGER,
    "freeProductId" TEXT,
    "freeProductQuantity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_benefits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumer_reward_grants" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "consumerId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "qualifyingSalesOrderId" TEXT NOT NULL,
    "promotionNameSnapshot" TEXT NOT NULL,
    "benefitTypeSnapshot" "PromotionBenefitType" NOT NULL,
    "pointsAwardedSnapshot" INTEGER,
    "freeProductIdSnapshot" TEXT,
    "freeProductQuantitySnapshot" INTEGER,
    "conditionsSnapshot" JSONB NOT NULL,
    "status" "RewardGrantStatus" NOT NULL DEFAULT 'GRANTED',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumer_reward_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_accounts" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "consumerId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_ledger_entries" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "loyaltyAccountId" TEXT NOT NULL,
    "consumerId" TEXT NOT NULL,
    "type" "LoyaltyLedgerEntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" TEXT,
    "rewardGrantId" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promotions_organisationId_idx" ON "promotions"("organisationId");

-- CreateIndex
CREATE INDEX "promotions_organisationId_status_idx" ON "promotions"("organisationId", "status");

-- CreateIndex
CREATE INDEX "promotions_organisationId_startsAt_endsAt_idx" ON "promotions"("organisationId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "promotion_conditions_organisationId_idx" ON "promotion_conditions"("organisationId");

-- CreateIndex
CREATE INDEX "promotion_conditions_promotionId_idx" ON "promotion_conditions"("promotionId");

-- CreateIndex
CREATE INDEX "promotion_benefits_organisationId_idx" ON "promotion_benefits"("organisationId");

-- CreateIndex
CREATE INDEX "promotion_benefits_promotionId_idx" ON "promotion_benefits"("promotionId");

-- CreateIndex
CREATE INDEX "consumer_reward_grants_organisationId_consumerId_idx" ON "consumer_reward_grants"("organisationId", "consumerId");

-- CreateIndex
CREATE INDEX "consumer_reward_grants_organisationId_qualifyingSalesOrderI_idx" ON "consumer_reward_grants"("organisationId", "qualifyingSalesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "consumer_reward_grants_organisationId_promotionId_consumerI_key" ON "consumer_reward_grants"("organisationId", "promotionId", "consumerId");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_accounts_consumerId_key" ON "loyalty_accounts"("consumerId");

-- CreateIndex
CREATE INDEX "loyalty_accounts_organisationId_idx" ON "loyalty_accounts"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_ledger_entries_rewardGrantId_key" ON "loyalty_ledger_entries"("rewardGrantId");

-- CreateIndex
CREATE INDEX "loyalty_ledger_entries_organisationId_loyaltyAccountId_idx" ON "loyalty_ledger_entries"("organisationId", "loyaltyAccountId");

-- CreateIndex
CREATE INDEX "loyalty_ledger_entries_organisationId_consumerId_idx" ON "loyalty_ledger_entries"("organisationId", "consumerId");

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_conditions" ADD CONSTRAINT "promotion_conditions_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_conditions" ADD CONSTRAINT "promotion_conditions_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_conditions" ADD CONSTRAINT "promotion_conditions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_conditions" ADD CONSTRAINT "promotion_conditions_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "territories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_benefits" ADD CONSTRAINT "promotion_benefits_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_benefits" ADD CONSTRAINT "promotion_benefits_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_benefits" ADD CONSTRAINT "promotion_benefits_freeProductId_fkey" FOREIGN KEY ("freeProductId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_reward_grants" ADD CONSTRAINT "consumer_reward_grants_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_reward_grants" ADD CONSTRAINT "consumer_reward_grants_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES "d2c_consumers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_reward_grants" ADD CONSTRAINT "consumer_reward_grants_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_reward_grants" ADD CONSTRAINT "consumer_reward_grants_qualifyingSalesOrderId_fkey" FOREIGN KEY ("qualifyingSalesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES "d2c_consumers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_ledger_entries" ADD CONSTRAINT "loyalty_ledger_entries_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_ledger_entries" ADD CONSTRAINT "loyalty_ledger_entries_loyaltyAccountId_fkey" FOREIGN KEY ("loyaltyAccountId") REFERENCES "loyalty_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_ledger_entries" ADD CONSTRAINT "loyalty_ledger_entries_rewardGrantId_fkey" FOREIGN KEY ("rewardGrantId") REFERENCES "consumer_reward_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

