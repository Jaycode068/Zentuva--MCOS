-- AlterTable
ALTER TABLE "hr_employees" ADD COLUMN     "territoryId" TEXT;

-- CreateIndex
CREATE INDEX "hr_employees_territoryId_idx" ON "hr_employees"("territoryId");

-- AddForeignKey
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "territories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
