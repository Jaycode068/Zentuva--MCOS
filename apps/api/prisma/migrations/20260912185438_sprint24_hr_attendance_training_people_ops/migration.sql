-- CreateEnum
CREATE TYPE "WorkScheduleStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'INCOMPLETE', 'OFF_DAY', 'EXCUSED', 'PENDING_REVIEW');

-- CreateEnum
CREATE TYPE "AttendanceReviewStatus" AS ENUM ('NOT_REVIEWED', 'APPROVED', 'REQUIRES_CORRECTION', 'REJECTED');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('SELF_SERVICE', 'ADMINISTRATIVE', 'IMPORTED');

-- CreateEnum
CREATE TYPE "AttendanceCorrectionStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PolicyScopeType" AS ENUM ('ORGANISATION', 'DEPARTMENT');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PolicyVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PolicyAcknowledgementSource" AS ENUM ('SELF_SERVICE', 'ADMINISTRATIVE');

-- CreateEnum
CREATE TYPE "TrainingDeliveryMode" AS ENUM ('IN_PERSON', 'ONLINE', 'BLENDED', 'SELF_STUDY');

-- CreateEnum
CREATE TYPE "TrainingCourseStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EmployeeTrainingStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'CANCELLED');

-- AlterTable
ALTER TABLE "hr_employees" ADD COLUMN     "workScheduleId" TEXT;

-- CreateTable
CREATE TABLE "hr_work_schedules" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "workDays" JSONB NOT NULL,
    "expectedStartTime" TEXT NOT NULL,
    "expectedEndTime" TEXT NOT NULL,
    "gracePeriodMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "WorkScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_work_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_attendance_records" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "attendanceDate" TIMESTAMP(3) NOT NULL,
    "workScheduleId" TEXT,
    "signInAt" TIMESTAMP(3),
    "signInLatitude" DOUBLE PRECISION,
    "signInLongitude" DOUBLE PRECISION,
    "signInAccuracyMeters" DOUBLE PRECISION,
    "signInLocationLabel" TEXT,
    "signOutAt" TIMESTAMP(3),
    "signOutLatitude" DOUBLE PRECISION,
    "signOutLongitude" DOUBLE PRECISION,
    "signOutAccuracyMeters" DOUBLE PRECISION,
    "signOutLocationLabel" TEXT,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewStatus" "AttendanceReviewStatus" NOT NULL DEFAULT 'NOT_REVIEWED',
    "source" "AttendanceSource" NOT NULL DEFAULT 'SELF_SERVICE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_attendance_correction_requests" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "attendanceRecordId" TEXT NOT NULL,
    "requestedByEmployeeId" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "requestedSignInAt" TIMESTAMP(3),
    "requestedSignOutAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "status" "AttendanceCorrectionStatus" NOT NULL DEFAULT 'REQUESTED',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_attendance_correction_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_policies" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scopeType" "PolicyScopeType" NOT NULL DEFAULT 'ORGANISATION',
    "departmentId" TEXT,
    "status" "PolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerDepartmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_policy_versions" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "requiresAcknowledgement" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "status" "PolicyVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_policy_acknowledgements" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedByUserId" TEXT,
    "source" "PolicyAcknowledgementSource" NOT NULL DEFAULT 'ADMINISTRATIVE',
    "notes" TEXT,

    CONSTRAINT "hr_policy_acknowledgements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_training_courses" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "provider" TEXT,
    "deliveryMode" "TrainingDeliveryMode" NOT NULL,
    "durationMinutes" INTEGER,
    "validityPeriodDays" INTEGER,
    "status" "TrainingCourseStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_training_courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_employee_trainings" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "trainingCourseId" TEXT NOT NULL,
    "assignedByUserId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "EmployeeTrainingStatus" NOT NULL DEFAULT 'ASSIGNED',
    "completionNotes" TEXT,
    "certificateDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_employee_trainings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hr_work_schedules_organisationId_idx" ON "hr_work_schedules"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_work_schedules_organisationId_code_key" ON "hr_work_schedules"("organisationId", "code");

-- CreateIndex
CREATE INDEX "hr_attendance_records_organisationId_idx" ON "hr_attendance_records"("organisationId");

-- CreateIndex
CREATE INDEX "hr_attendance_records_employeeId_idx" ON "hr_attendance_records"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_attendance_records_organisationId_employeeId_attendanceD_key" ON "hr_attendance_records"("organisationId", "employeeId", "attendanceDate");

-- CreateIndex
CREATE INDEX "hr_attendance_correction_requests_organisationId_idx" ON "hr_attendance_correction_requests"("organisationId");

-- CreateIndex
CREATE INDEX "hr_attendance_correction_requests_attendanceRecordId_idx" ON "hr_attendance_correction_requests"("attendanceRecordId");

-- CreateIndex
CREATE INDEX "hr_policies_organisationId_idx" ON "hr_policies"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_policies_organisationId_code_key" ON "hr_policies"("organisationId", "code");

-- CreateIndex
CREATE INDEX "hr_policy_versions_organisationId_idx" ON "hr_policy_versions"("organisationId");

-- CreateIndex
CREATE INDEX "hr_policy_versions_policyId_idx" ON "hr_policy_versions"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_policy_versions_policyId_versionNumber_key" ON "hr_policy_versions"("policyId", "versionNumber");

-- CreateIndex
CREATE INDEX "hr_policy_acknowledgements_organisationId_idx" ON "hr_policy_acknowledgements"("organisationId");

-- CreateIndex
CREATE INDEX "hr_policy_acknowledgements_policyVersionId_idx" ON "hr_policy_acknowledgements"("policyVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_policy_acknowledgements_employeeId_policyVersionId_key" ON "hr_policy_acknowledgements"("employeeId", "policyVersionId");

-- CreateIndex
CREATE INDEX "hr_training_courses_organisationId_idx" ON "hr_training_courses"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_training_courses_organisationId_code_key" ON "hr_training_courses"("organisationId", "code");

-- CreateIndex
CREATE INDEX "hr_employee_trainings_organisationId_idx" ON "hr_employee_trainings"("organisationId");

-- CreateIndex
CREATE INDEX "hr_employee_trainings_employeeId_idx" ON "hr_employee_trainings"("employeeId");

-- CreateIndex
CREATE INDEX "hr_employee_trainings_trainingCourseId_idx" ON "hr_employee_trainings"("trainingCourseId");

-- CreateIndex
CREATE INDEX "hr_employees_workScheduleId_idx" ON "hr_employees"("workScheduleId");

-- AddForeignKey
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_workScheduleId_fkey" FOREIGN KEY ("workScheduleId") REFERENCES "hr_work_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_work_schedules" ADD CONSTRAINT "hr_work_schedules_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance_records" ADD CONSTRAINT "hr_attendance_records_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance_records" ADD CONSTRAINT "hr_attendance_records_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance_correction_requests" ADD CONSTRAINT "hr_attendance_correction_requests_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance_correction_requests" ADD CONSTRAINT "hr_attendance_correction_requests_attendanceRecordId_fkey" FOREIGN KEY ("attendanceRecordId") REFERENCES "hr_attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance_correction_requests" ADD CONSTRAINT "hr_attendance_correction_requests_requestedByEmployeeId_fkey" FOREIGN KEY ("requestedByEmployeeId") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_policies" ADD CONSTRAINT "hr_policies_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_policies" ADD CONSTRAINT "hr_policies_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "hr_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_policies" ADD CONSTRAINT "hr_policies_ownerDepartmentId_fkey" FOREIGN KEY ("ownerDepartmentId") REFERENCES "hr_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_policy_versions" ADD CONSTRAINT "hr_policy_versions_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_policy_versions" ADD CONSTRAINT "hr_policy_versions_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "hr_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_policy_acknowledgements" ADD CONSTRAINT "hr_policy_acknowledgements_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_policy_acknowledgements" ADD CONSTRAINT "hr_policy_acknowledgements_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_policy_acknowledgements" ADD CONSTRAINT "hr_policy_acknowledgements_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "hr_policy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_training_courses" ADD CONSTRAINT "hr_training_courses_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_trainings" ADD CONSTRAINT "hr_employee_trainings_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_trainings" ADD CONSTRAINT "hr_employee_trainings_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_trainings" ADD CONSTRAINT "hr_employee_trainings_trainingCourseId_fkey" FOREIGN KEY ("trainingCourseId") REFERENCES "hr_training_courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_trainings" ADD CONSTRAINT "hr_employee_trainings_certificateDocumentId_fkey" FOREIGN KEY ("certificateDocumentId") REFERENCES "hr_employee_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
