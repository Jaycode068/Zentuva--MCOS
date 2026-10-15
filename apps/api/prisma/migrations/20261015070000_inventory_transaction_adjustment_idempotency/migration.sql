-- Stage 4E.4B — Inventory Adjustment Idempotency.
-- Additive only: a nullable column plus a composite unique index. No existing row's
-- data changes (every existing InventoryTransaction gets idempotencyKey = NULL, and
-- Postgres unique indexes treat every NULL as distinct, so no existing row can
-- collide with another or with any future row that also has a NULL key).
ALTER TABLE "inventory_transactions" ADD COLUMN     "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "inventory_transactions_organisationId_idempotencyKey_key" ON "inventory_transactions"("organisationId", "idempotencyKey");
