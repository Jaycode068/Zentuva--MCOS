/*
  Warnings:

  - You are about to drop the column `firstAttemptedAt` on the `whatsapp_deliveries` table. All the data in the column will be lost.
  - You are about to drop the column `lastAttemptedAt` on the `whatsapp_deliveries` table. All the data in the column will be lost.
  - You are about to drop the column `leaseAt` on the `whatsapp_deliveries` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "whatsapp_deliveries" DROP COLUMN "firstAttemptedAt",
DROP COLUMN "lastAttemptedAt",
DROP COLUMN "leaseAt";
