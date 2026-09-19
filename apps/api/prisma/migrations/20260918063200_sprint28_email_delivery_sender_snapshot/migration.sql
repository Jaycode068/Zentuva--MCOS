/*
  Warnings:

  - Added the required column `fromEmail` to the `email_deliveries` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fromName` to the `email_deliveries` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "email_deliveries" ADD COLUMN     "fromEmail" TEXT NOT NULL,
ADD COLUMN     "fromName" TEXT NOT NULL;
