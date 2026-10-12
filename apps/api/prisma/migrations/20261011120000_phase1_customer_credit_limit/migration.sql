-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "creditLimit" DOUBLE PRECISION;

-- Defense-in-depth: reject a negative credit limit at the database level too, not just
-- in the Zod schema (Phase 1 Customer Account Management brief §5C: "Negative credit
-- limits must be rejected"). NULL (no limit configured) is explicitly allowed.
ALTER TABLE "customers" ADD CONSTRAINT "customers_creditLimit_non_negative"
  CHECK ("creditLimit" IS NULL OR "creditLimit" >= 0);
