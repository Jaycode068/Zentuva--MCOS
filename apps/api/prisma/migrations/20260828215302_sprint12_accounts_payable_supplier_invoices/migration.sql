-- CreateEnum
CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID');

-- CreateEnum
CREATE TYPE "SupplierInvoiceMatchStatus" AS ENUM ('UNVERIFIED', 'MATCHED', 'DISCREPANCY');

-- AlterTable
ALTER TABLE "goods_receipt_items" ADD COLUMN     "invoicedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "supplier_invoices" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paymentTerms" "PaymentTermType" NOT NULL,
    "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "matchStatus" "SupplierInvoiceMatchStatus",
    "recognizedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "varianceAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amountCredited" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "postIdempotencyKey" TEXT,
    "postedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "discrepancyResolvedAt" TIMESTAMP(3),
    "discrepancyResolvedById" TEXT,
    "discrepancyResolutionNotes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoice_items" (
    "id" TEXT NOT NULL,
    "supplierInvoiceId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "lineTotal" DOUBLE PRECISION NOT NULL,
    "goodsReceiptItemId" TEXT,
    "debitAccountId" TEXT,
    "recognizedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "varianceAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'RECORDED',
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payment_allocations" (
    "id" TEXT NOT NULL,
    "supplierPaymentId" TEXT NOT NULL,
    "supplierInvoiceId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_credit_notes" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "creditNoteCode" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierInvoiceId" TEXT,
    "reason" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "creditNoteDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_invoices_organisationId_idx" ON "supplier_invoices"("organisationId");

-- CreateIndex
CREATE INDEX "supplier_invoices_organisationId_supplierId_idx" ON "supplier_invoices"("organisationId", "supplierId");

-- CreateIndex
CREATE INDEX "supplier_invoices_organisationId_status_idx" ON "supplier_invoices"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_supplierId_invoiceNumber_key" ON "supplier_invoices"("supplierId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_supplierId_idempotencyKey_key" ON "supplier_invoices"("supplierId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_supplierId_postIdempotencyKey_key" ON "supplier_invoices"("supplierId", "postIdempotencyKey");

-- CreateIndex
CREATE INDEX "supplier_invoice_items_supplierInvoiceId_idx" ON "supplier_invoice_items"("supplierInvoiceId");

-- CreateIndex
CREATE INDEX "supplier_invoice_items_goodsReceiptItemId_idx" ON "supplier_invoice_items"("goodsReceiptItemId");

-- CreateIndex
CREATE INDEX "supplier_invoice_items_debitAccountId_idx" ON "supplier_invoice_items"("debitAccountId");

-- CreateIndex
CREATE INDEX "supplier_payments_organisationId_idx" ON "supplier_payments"("organisationId");

-- CreateIndex
CREATE INDEX "supplier_payments_organisationId_supplierId_idx" ON "supplier_payments"("organisationId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_supplierId_idempotencyKey_key" ON "supplier_payments"("supplierId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "supplier_payment_allocations_supplierPaymentId_idx" ON "supplier_payment_allocations"("supplierPaymentId");

-- CreateIndex
CREATE INDEX "supplier_payment_allocations_supplierInvoiceId_idx" ON "supplier_payment_allocations"("supplierInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_credit_notes_creditNoteCode_key" ON "supplier_credit_notes"("creditNoteCode");

-- CreateIndex
CREATE INDEX "supplier_credit_notes_organisationId_idx" ON "supplier_credit_notes"("organisationId");

-- CreateIndex
CREATE INDEX "supplier_credit_notes_organisationId_supplierId_idx" ON "supplier_credit_notes"("organisationId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_credit_notes_supplierInvoiceId_idempotencyKey_key" ON "supplier_credit_notes"("supplierInvoiceId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_items" ADD CONSTRAINT "supplier_invoice_items_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "supplier_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_items" ADD CONSTRAINT "supplier_invoice_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_items" ADD CONSTRAINT "supplier_invoice_items_goodsReceiptItemId_fkey" FOREIGN KEY ("goodsReceiptItemId") REFERENCES "goods_receipt_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_items" ADD CONSTRAINT "supplier_invoice_items_debitAccountId_fkey" FOREIGN KEY ("debitAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_supplierPaymentId_fkey" FOREIGN KEY ("supplierPaymentId") REFERENCES "supplier_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
