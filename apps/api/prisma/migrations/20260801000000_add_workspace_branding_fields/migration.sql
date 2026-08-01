-- AlterTable
ALTER TABLE "organisations" ADD COLUMN     "accentColor" TEXT,
ADD COLUMN     "darkLogoUrl" TEXT,
ADD COLUMN     "employeeCount" TEXT,
ADD COLUMN     "numberFormat" TEXT NOT NULL DEFAULT '1,234.56',
ADD COLUMN     "primaryColor" TEXT,
ADD COLUMN     "registrationNumber" TEXT,
ADD COLUMN     "taxId" TEXT,
ADD COLUMN     "timeFormat" TEXT NOT NULL DEFAULT 'HH:mm';

