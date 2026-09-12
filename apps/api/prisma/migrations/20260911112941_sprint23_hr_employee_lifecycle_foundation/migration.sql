-- CreateEnum
CREATE TYPE "DepartmentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY', 'INTERN', 'CASUAL', 'VOLUNTEER');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('DRAFT', 'ONBOARDING', 'ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'SEPARATED');

-- CreateEnum
CREATE TYPE "EmployeeDocumentType" AS ENUM ('EMPLOYMENT_CONTRACT', 'IDENTIFICATION', 'QUALIFICATION', 'CERTIFICATION', 'POLICY_ACKNOWLEDGEMENT', 'ONBOARDING_DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "EmployeeDocumentStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "hr_departments" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentDepartmentId" TEXT,
    "departmentHeadEmployeeId" TEXT,
    "status" "DepartmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_positions" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "departmentId" TEXT,
    "reportsToPositionId" TEXT,
    "status" "PositionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_employees" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "userId" TEXT,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "preferredName" TEXT,
    "workEmail" TEXT,
    "personalEmail" TEXT,
    "phoneNumber" TEXT,
    "alternatePhoneNumber" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" "Gender",
    "nationality" TEXT,
    "address" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "emergencyContactRelationship" TEXT,
    "departmentId" TEXT,
    "positionId" TEXT,
    "managerEmployeeId" TEXT,
    "employmentType" "EmploymentType" NOT NULL,
    "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'DRAFT',
    "hireDate" TIMESTAMP(3) NOT NULL,
    "probationEndDate" TIMESTAMP(3),
    "confirmationDate" TIMESTAMP(3),
    "separationDate" TIMESTAMP(3),
    "separationReason" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_employee_documents" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "documentType" "EmployeeDocumentType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "issuedDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "status" "EmployeeDocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_employee_onboarding" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" TIMESTAMP(3),
    "targetCompletionDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_employee_onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_employee_onboarding_tasks" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "onboardingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_employee_onboarding_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hr_departments_organisationId_idx" ON "hr_departments"("organisationId");

-- CreateIndex
CREATE INDEX "hr_departments_parentDepartmentId_idx" ON "hr_departments"("parentDepartmentId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_departments_organisationId_code_key" ON "hr_departments"("organisationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "hr_departments_organisationId_name_key" ON "hr_departments"("organisationId", "name");

-- CreateIndex
CREATE INDEX "hr_positions_organisationId_idx" ON "hr_positions"("organisationId");

-- CreateIndex
CREATE INDEX "hr_positions_departmentId_idx" ON "hr_positions"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_positions_organisationId_code_key" ON "hr_positions"("organisationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "hr_positions_organisationId_title_key" ON "hr_positions"("organisationId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "hr_employees_userId_key" ON "hr_employees"("userId");

-- CreateIndex
CREATE INDEX "hr_employees_organisationId_idx" ON "hr_employees"("organisationId");

-- CreateIndex
CREATE INDEX "hr_employees_departmentId_idx" ON "hr_employees"("departmentId");

-- CreateIndex
CREATE INDEX "hr_employees_positionId_idx" ON "hr_employees"("positionId");

-- CreateIndex
CREATE INDEX "hr_employees_managerEmployeeId_idx" ON "hr_employees"("managerEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_employees_organisationId_employeeCode_key" ON "hr_employees"("organisationId", "employeeCode");

-- CreateIndex
CREATE INDEX "hr_employee_documents_organisationId_idx" ON "hr_employee_documents"("organisationId");

-- CreateIndex
CREATE INDEX "hr_employee_documents_employeeId_idx" ON "hr_employee_documents"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_employee_onboarding_employeeId_key" ON "hr_employee_onboarding"("employeeId");

-- CreateIndex
CREATE INDEX "hr_employee_onboarding_organisationId_idx" ON "hr_employee_onboarding"("organisationId");

-- CreateIndex
CREATE INDEX "hr_employee_onboarding_tasks_organisationId_idx" ON "hr_employee_onboarding_tasks"("organisationId");

-- CreateIndex
CREATE INDEX "hr_employee_onboarding_tasks_onboardingId_idx" ON "hr_employee_onboarding_tasks"("onboardingId");

-- AddForeignKey
ALTER TABLE "hr_departments" ADD CONSTRAINT "hr_departments_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_departments" ADD CONSTRAINT "hr_departments_parentDepartmentId_fkey" FOREIGN KEY ("parentDepartmentId") REFERENCES "hr_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_departments" ADD CONSTRAINT "hr_departments_departmentHeadEmployeeId_fkey" FOREIGN KEY ("departmentHeadEmployeeId") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_positions" ADD CONSTRAINT "hr_positions_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_positions" ADD CONSTRAINT "hr_positions_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "hr_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_positions" ADD CONSTRAINT "hr_positions_reportsToPositionId_fkey" FOREIGN KEY ("reportsToPositionId") REFERENCES "hr_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "hr_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "hr_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_managerEmployeeId_fkey" FOREIGN KEY ("managerEmployeeId") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_documents" ADD CONSTRAINT "hr_employee_documents_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_documents" ADD CONSTRAINT "hr_employee_documents_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_onboarding" ADD CONSTRAINT "hr_employee_onboarding_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_onboarding" ADD CONSTRAINT "hr_employee_onboarding_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_onboarding_tasks" ADD CONSTRAINT "hr_employee_onboarding_tasks_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_onboarding_tasks" ADD CONSTRAINT "hr_employee_onboarding_tasks_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "hr_employee_onboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
