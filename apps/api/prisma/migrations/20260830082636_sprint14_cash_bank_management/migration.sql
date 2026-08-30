-- CreateEnum
CREATE TYPE "CashAccountType" AS ENUM ('BANK', 'CASH', 'OTHER_CASH_EQUIVALENT');

-- CreateEnum
CREATE TYPE "CashAccountStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CashTransactionType" AS ENUM ('RECEIPT', 'PAYMENT');

-- CreateEnum
CREATE TYPE "BankTransactionMatchStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'RECONCILED');

-- CreateEnum
CREATE TYPE "BankReconciliationStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ReconciliationMatchType" AS ENUM ('MANUAL', 'EXACT_AUTO');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "cashAccountId" TEXT;

-- AlterTable
ALTER TABLE "supplier_payments" ADD COLUMN     "cashAccountId" TEXT;

-- CreateTable
CREATE TABLE "cash_accounts" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountType" "CashAccountType" NOT NULL,
    "currency" TEXT NOT NULL,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "accountName" TEXT,
    "description" TEXT,
    "status" "CashAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "linkedChartOfAccountId" TEXT NOT NULL,
    "openingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "openingBalanceDate" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_transactions" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "cashAccountId" TEXT NOT NULL,
    "transactionType" "CashTransactionType" NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "contraAccountId" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'RECORDED',
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_imports" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "cashAccountId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "importedById" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bank_statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_transactions" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "cashAccountId" TEXT NOT NULL,
    "importBatchId" TEXT,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "valueDate" TIMESTAMP(3),
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL,
    "balance" DOUBLE PRECISION,
    "externalReference" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedupeHash" TEXT NOT NULL,
    "matchStatus" "BankTransactionMatchStatus" NOT NULL DEFAULT 'UNMATCHED',

    CONSTRAINT "bank_statement_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_reconciliations" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "cashAccountId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "openingBankBalance" DOUBLE PRECISION NOT NULL,
    "closingBankBalance" DOUBLE PRECISION NOT NULL,
    "status" "BankReconciliationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "reconciledById" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_matches" (
    "id" TEXT NOT NULL,
    "bankReconciliationId" TEXT NOT NULL,
    "bankStatementTransactionId" TEXT NOT NULL,
    "journalEntryLineId" TEXT NOT NULL,
    "matchType" "ReconciliationMatchType" NOT NULL,
    "confidenceScore" DOUBLE PRECISION,
    "matchedById" TEXT,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_accounts_linkedChartOfAccountId_key" ON "cash_accounts"("linkedChartOfAccountId");

-- CreateIndex
CREATE INDEX "cash_accounts_organisationId_idx" ON "cash_accounts"("organisationId");

-- CreateIndex
CREATE INDEX "cash_accounts_organisationId_status_idx" ON "cash_accounts"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cash_accounts_organisationId_accountCode_key" ON "cash_accounts"("organisationId", "accountCode");

-- CreateIndex
CREATE UNIQUE INDEX "cash_accounts_organisationId_idempotencyKey_key" ON "cash_accounts"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "cash_transactions_organisationId_idx" ON "cash_transactions"("organisationId");

-- CreateIndex
CREATE INDEX "cash_transactions_organisationId_cashAccountId_idx" ON "cash_transactions"("organisationId", "cashAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_transactions_cashAccountId_idempotencyKey_key" ON "cash_transactions"("cashAccountId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "bank_statement_imports_organisationId_cashAccountId_idx" ON "bank_statement_imports"("organisationId", "cashAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_imports_cashAccountId_idempotencyKey_key" ON "bank_statement_imports"("cashAccountId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "bank_statement_transactions_organisationId_cashAccountId_idx" ON "bank_statement_transactions"("organisationId", "cashAccountId");

-- CreateIndex
CREATE INDEX "bank_statement_transactions_cashAccountId_transactionDate_idx" ON "bank_statement_transactions"("cashAccountId", "transactionDate");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_transactions_cashAccountId_dedupeHash_key" ON "bank_statement_transactions"("cashAccountId", "dedupeHash");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_transactions_cashAccountId_externalReference_key" ON "bank_statement_transactions"("cashAccountId", "externalReference");

-- CreateIndex
CREATE INDEX "bank_reconciliations_organisationId_cashAccountId_idx" ON "bank_reconciliations"("organisationId", "cashAccountId");

-- CreateIndex
CREATE INDEX "bank_reconciliations_organisationId_status_idx" ON "bank_reconciliations"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bank_reconciliations_cashAccountId_idempotencyKey_key" ON "bank_reconciliations"("cashAccountId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_matches_bankStatementTransactionId_key" ON "reconciliation_matches"("bankStatementTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_matches_journalEntryLineId_key" ON "reconciliation_matches"("journalEntryLineId");

-- CreateIndex
CREATE INDEX "reconciliation_matches_bankReconciliationId_idx" ON "reconciliation_matches"("bankReconciliationId");

-- CreateIndex
CREATE INDEX "payments_cashAccountId_idx" ON "payments"("cashAccountId");

-- CreateIndex
CREATE INDEX "supplier_payments_cashAccountId_idx" ON "supplier_payments"("cashAccountId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_linkedChartOfAccountId_fkey" FOREIGN KEY ("linkedChartOfAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_contraAccountId_fkey" FOREIGN KEY ("contraAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_transactions" ADD CONSTRAINT "bank_statement_transactions_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_transactions" ADD CONSTRAINT "bank_statement_transactions_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_transactions" ADD CONSTRAINT "bank_statement_transactions_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "bank_statement_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_bankReconciliationId_fkey" FOREIGN KEY ("bankReconciliationId") REFERENCES "bank_reconciliations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_bankStatementTransactionId_fkey" FOREIGN KEY ("bankStatementTransactionId") REFERENCES "bank_statement_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_journalEntryLineId_fkey" FOREIGN KEY ("journalEntryLineId") REFERENCES "journal_entry_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
