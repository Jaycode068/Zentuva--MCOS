-- CreateEnum
CREATE TYPE "HiringRequestReason" AS ENUM ('NEW_POSITION', 'REPLACEMENT', 'EXPANSION', 'OTHER');

-- CreateEnum
CREATE TYPE "HiringRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkArrangement" AS ENUM ('ON_SITE', 'REMOTE', 'HYBRID');

-- CreateEnum
CREATE TYPE "VacancyStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApplicationQuestionType" AS ENUM ('TEXT', 'YES_NO', 'NUMBER', 'FILE');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('SUBMITTED', 'SCREENING', 'SHORTLISTED', 'INTERVIEWING', 'SELECTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InterviewRecommendation" AS ENUM ('PROCEED', 'HOLD', 'REJECT', 'RECOMMEND_HIRE', 'RECOMMEND_REJECT');

-- CreateEnum
CREATE TYPE "StageDecisionType" AS ENUM ('ADVANCE', 'HOLD', 'REJECT');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'ISSUED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'RECRUITMENT_INTERVIEWS';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'INTERVIEW_SCHEDULED';
ALTER TYPE "NotificationType" ADD VALUE 'INTERVIEW_EVALUATION_REQUIRED';

-- CreateTable
CREATE TABLE "hr_recruitment_hiring_requests" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "requestedHeadcount" INTEGER NOT NULL DEFAULT 1,
    "employmentType" "EmploymentType" NOT NULL,
    "reason" "HiringRequestReason" NOT NULL,
    "justification" TEXT,
    "requestedStartDate" TIMESTAMP(3),
    "requestedById" TEXT NOT NULL,
    "status" "HiringRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_recruitment_hiring_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_recruitment_vacancies" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "departmentId" TEXT,
    "hiringRequestId" TEXT,
    "numberOfOpenings" INTEGER NOT NULL DEFAULT 1,
    "employmentType" "EmploymentType" NOT NULL,
    "workArrangement" "WorkArrangement" NOT NULL,
    "location" TEXT,
    "salaryMin" DOUBLE PRECISION,
    "salaryMax" DOUBLE PRECISION,
    "description" TEXT NOT NULL,
    "responsibilities" TEXT NOT NULL,
    "requirements" TEXT NOT NULL,
    "qualifications" TEXT NOT NULL,
    "experienceRequirements" TEXT,
    "applicationDeadline" TIMESTAMP(3),
    "status" "VacancyStatus" NOT NULL DEFAULT 'DRAFT',
    "publicSlug" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_recruitment_vacancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_recruitment_vacancy_questions" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "ApplicationQuestionType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_recruitment_vacancy_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_recruitment_candidates" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_recruitment_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_recruitment_applications" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "resumeUrl" TEXT,
    "resumeKey" TEXT,
    "coverLetterText" TEXT,
    "screeningNotes" TEXT,
    "screenedByUserId" TEXT,
    "screenedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_recruitment_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_recruitment_application_answers" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "vacancyQuestionId" TEXT NOT NULL,
    "answerText" TEXT,
    "answerNumber" DOUBLE PRECISION,
    "answerBoolean" BOOLEAN,
    "answerFileUrl" TEXT,
    "answerFileKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_recruitment_application_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_recruitment_interview_stages" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sequence" INTEGER NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "evaluationRequired" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_recruitment_interview_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_recruitment_interview_stage_participants" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "interviewStageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_recruitment_interview_stage_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_recruitment_interviews" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "interviewStageId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "location" TEXT,
    "meetingLink" TEXT,
    "status" "InterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_recruitment_interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_recruitment_interview_participants" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_recruitment_interview_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_recruitment_interview_evaluations" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "evaluatorUserId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "recommendation" "InterviewRecommendation" NOT NULL,
    "comments" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reopenedAt" TIMESTAMP(3),
    "reopenedByUserId" TEXT,

    CONSTRAINT "hr_recruitment_interview_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_recruitment_interview_stage_decisions" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "decision" "StageDecisionType" NOT NULL,
    "decidedByUserId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,

    CONSTRAINT "hr_recruitment_interview_stage_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_recruitment_offers" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "proposedSalary" DOUBLE PRECISION,
    "employmentType" "EmploymentType" NOT NULL,
    "proposedStartDate" TIMESTAMP(3),
    "offerDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiryDate" TIMESTAMP(3),
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "issuedByUserId" TEXT,
    "respondedAt" TIMESTAMP(3),
    "convertedEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_recruitment_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hr_recruitment_hiring_requests_organisationId_idx" ON "hr_recruitment_hiring_requests"("organisationId");

-- CreateIndex
CREATE INDEX "hr_recruitment_hiring_requests_organisationId_status_idx" ON "hr_recruitment_hiring_requests"("organisationId", "status");

-- CreateIndex
CREATE INDEX "hr_recruitment_hiring_requests_departmentId_idx" ON "hr_recruitment_hiring_requests"("departmentId");

-- CreateIndex
CREATE INDEX "hr_recruitment_hiring_requests_positionId_idx" ON "hr_recruitment_hiring_requests"("positionId");

-- CreateIndex
CREATE INDEX "hr_recruitment_vacancies_organisationId_idx" ON "hr_recruitment_vacancies"("organisationId");

-- CreateIndex
CREATE INDEX "hr_recruitment_vacancies_organisationId_status_idx" ON "hr_recruitment_vacancies"("organisationId", "status");

-- CreateIndex
CREATE INDEX "hr_recruitment_vacancies_positionId_idx" ON "hr_recruitment_vacancies"("positionId");

-- CreateIndex
CREATE INDEX "hr_recruitment_vacancies_departmentId_idx" ON "hr_recruitment_vacancies"("departmentId");

-- CreateIndex
CREATE INDEX "hr_recruitment_vacancies_hiringRequestId_idx" ON "hr_recruitment_vacancies"("hiringRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_recruitment_vacancies_organisationId_publicSlug_key" ON "hr_recruitment_vacancies"("organisationId", "publicSlug");

-- CreateIndex
CREATE INDEX "hr_recruitment_vacancy_questions_organisationId_idx" ON "hr_recruitment_vacancy_questions"("organisationId");

-- CreateIndex
CREATE INDEX "hr_recruitment_vacancy_questions_vacancyId_idx" ON "hr_recruitment_vacancy_questions"("vacancyId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_recruitment_vacancy_questions_vacancyId_sortOrder_key" ON "hr_recruitment_vacancy_questions"("vacancyId", "sortOrder");

-- CreateIndex
CREATE INDEX "hr_recruitment_candidates_organisationId_idx" ON "hr_recruitment_candidates"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_recruitment_candidates_organisationId_email_key" ON "hr_recruitment_candidates"("organisationId", "email");

-- CreateIndex
CREATE INDEX "hr_recruitment_applications_organisationId_idx" ON "hr_recruitment_applications"("organisationId");

-- CreateIndex
CREATE INDEX "hr_recruitment_applications_organisationId_status_idx" ON "hr_recruitment_applications"("organisationId", "status");

-- CreateIndex
CREATE INDEX "hr_recruitment_applications_vacancyId_idx" ON "hr_recruitment_applications"("vacancyId");

-- CreateIndex
CREATE INDEX "hr_recruitment_applications_candidateId_idx" ON "hr_recruitment_applications"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_recruitment_applications_organisationId_vacancyId_candid_key" ON "hr_recruitment_applications"("organisationId", "vacancyId", "candidateId");

-- CreateIndex
CREATE INDEX "hr_recruitment_application_answers_organisationId_idx" ON "hr_recruitment_application_answers"("organisationId");

-- CreateIndex
CREATE INDEX "hr_recruitment_application_answers_applicationId_idx" ON "hr_recruitment_application_answers"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_recruitment_application_answers_applicationId_vacancyQue_key" ON "hr_recruitment_application_answers"("applicationId", "vacancyQuestionId");

-- CreateIndex
CREATE INDEX "hr_recruitment_interview_stages_organisationId_idx" ON "hr_recruitment_interview_stages"("organisationId");

-- CreateIndex
CREATE INDEX "hr_recruitment_interview_stages_vacancyId_idx" ON "hr_recruitment_interview_stages"("vacancyId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_recruitment_interview_stages_vacancyId_sequence_key" ON "hr_recruitment_interview_stages"("vacancyId", "sequence");

-- CreateIndex
CREATE INDEX "hr_recruitment_interview_stage_participants_organisationId_idx" ON "hr_recruitment_interview_stage_participants"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_recruitment_interview_stage_participants_interviewStageI_key" ON "hr_recruitment_interview_stage_participants"("interviewStageId", "userId");

-- CreateIndex
CREATE INDEX "hr_recruitment_interviews_organisationId_idx" ON "hr_recruitment_interviews"("organisationId");

-- CreateIndex
CREATE INDEX "hr_recruitment_interviews_applicationId_idx" ON "hr_recruitment_interviews"("applicationId");

-- CreateIndex
CREATE INDEX "hr_recruitment_interviews_interviewStageId_idx" ON "hr_recruitment_interviews"("interviewStageId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_recruitment_interviews_applicationId_interviewStageId_key" ON "hr_recruitment_interviews"("applicationId", "interviewStageId");

-- CreateIndex
CREATE INDEX "hr_recruitment_interview_participants_organisationId_idx" ON "hr_recruitment_interview_participants"("organisationId");

-- CreateIndex
CREATE INDEX "hr_recruitment_interview_participants_userId_idx" ON "hr_recruitment_interview_participants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_recruitment_interview_participants_interviewId_userId_key" ON "hr_recruitment_interview_participants"("interviewId", "userId");

-- CreateIndex
CREATE INDEX "hr_recruitment_interview_evaluations_organisationId_idx" ON "hr_recruitment_interview_evaluations"("organisationId");

-- CreateIndex
CREATE INDEX "hr_recruitment_interview_evaluations_interviewId_idx" ON "hr_recruitment_interview_evaluations"("interviewId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_recruitment_interview_evaluations_interviewId_evaluatorU_key" ON "hr_recruitment_interview_evaluations"("interviewId", "evaluatorUserId");

-- CreateIndex
CREATE INDEX "hr_recruitment_interview_stage_decisions_organisationId_idx" ON "hr_recruitment_interview_stage_decisions"("organisationId");

-- CreateIndex
CREATE INDEX "hr_recruitment_interview_stage_decisions_interviewId_idx" ON "hr_recruitment_interview_stage_decisions"("interviewId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_recruitment_offers_convertedEmployeeId_key" ON "hr_recruitment_offers"("convertedEmployeeId");

-- CreateIndex
CREATE INDEX "hr_recruitment_offers_organisationId_idx" ON "hr_recruitment_offers"("organisationId");

-- CreateIndex
CREATE INDEX "hr_recruitment_offers_organisationId_status_idx" ON "hr_recruitment_offers"("organisationId", "status");

-- CreateIndex
CREATE INDEX "hr_recruitment_offers_applicationId_idx" ON "hr_recruitment_offers"("applicationId");

-- AddForeignKey
ALTER TABLE "hr_recruitment_hiring_requests" ADD CONSTRAINT "hr_recruitment_hiring_requests_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_hiring_requests" ADD CONSTRAINT "hr_recruitment_hiring_requests_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "hr_departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_hiring_requests" ADD CONSTRAINT "hr_recruitment_hiring_requests_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "hr_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_vacancies" ADD CONSTRAINT "hr_recruitment_vacancies_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_vacancies" ADD CONSTRAINT "hr_recruitment_vacancies_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "hr_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_vacancies" ADD CONSTRAINT "hr_recruitment_vacancies_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "hr_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_vacancies" ADD CONSTRAINT "hr_recruitment_vacancies_hiringRequestId_fkey" FOREIGN KEY ("hiringRequestId") REFERENCES "hr_recruitment_hiring_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_vacancy_questions" ADD CONSTRAINT "hr_recruitment_vacancy_questions_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_vacancy_questions" ADD CONSTRAINT "hr_recruitment_vacancy_questions_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "hr_recruitment_vacancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_candidates" ADD CONSTRAINT "hr_recruitment_candidates_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_applications" ADD CONSTRAINT "hr_recruitment_applications_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_applications" ADD CONSTRAINT "hr_recruitment_applications_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "hr_recruitment_vacancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_applications" ADD CONSTRAINT "hr_recruitment_applications_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "hr_recruitment_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_application_answers" ADD CONSTRAINT "hr_recruitment_application_answers_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_application_answers" ADD CONSTRAINT "hr_recruitment_application_answers_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_recruitment_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_application_answers" ADD CONSTRAINT "hr_recruitment_application_answers_vacancyQuestionId_fkey" FOREIGN KEY ("vacancyQuestionId") REFERENCES "hr_recruitment_vacancy_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_interview_stages" ADD CONSTRAINT "hr_recruitment_interview_stages_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_interview_stages" ADD CONSTRAINT "hr_recruitment_interview_stages_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "hr_recruitment_vacancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_interview_stage_participants" ADD CONSTRAINT "hr_recruitment_interview_stage_participants_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_interview_stage_participants" ADD CONSTRAINT "hr_recruitment_interview_stage_participants_interviewStage_fkey" FOREIGN KEY ("interviewStageId") REFERENCES "hr_recruitment_interview_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_interviews" ADD CONSTRAINT "hr_recruitment_interviews_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_interviews" ADD CONSTRAINT "hr_recruitment_interviews_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_recruitment_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_interviews" ADD CONSTRAINT "hr_recruitment_interviews_interviewStageId_fkey" FOREIGN KEY ("interviewStageId") REFERENCES "hr_recruitment_interview_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_interview_participants" ADD CONSTRAINT "hr_recruitment_interview_participants_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_interview_participants" ADD CONSTRAINT "hr_recruitment_interview_participants_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "hr_recruitment_interviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_interview_evaluations" ADD CONSTRAINT "hr_recruitment_interview_evaluations_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_interview_evaluations" ADD CONSTRAINT "hr_recruitment_interview_evaluations_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "hr_recruitment_interviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_interview_stage_decisions" ADD CONSTRAINT "hr_recruitment_interview_stage_decisions_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_interview_stage_decisions" ADD CONSTRAINT "hr_recruitment_interview_stage_decisions_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "hr_recruitment_interviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_offers" ADD CONSTRAINT "hr_recruitment_offers_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_offers" ADD CONSTRAINT "hr_recruitment_offers_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_recruitment_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_recruitment_offers" ADD CONSTRAINT "hr_recruitment_offers_convertedEmployeeId_fkey" FOREIGN KEY ("convertedEmployeeId") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Sprint 30 — partial unique index: at most one non-terminal (DRAFT/ISSUED)
-- Offer per Application at a time. Not expressible in Prisma schema syntax
-- directly (a WHERE-clause-qualified unique index) — same raw-SQL idiom
-- already used for Workflow's own single-active-instance-per-subject index.
-- Guards against duplicate-offer-creation races (brief §43).
CREATE UNIQUE INDEX "hr_recruitment_offers_one_active_per_application"
  ON "hr_recruitment_offers" ("applicationId")
  WHERE "status" IN ('DRAFT', 'ISSUED');

-- Sprint 30 — partial unique index scoped to Recruitment-sourced
-- notifications only (see the Notification model's own doc comment in
-- schema.prisma for why a broad, unscoped version is wrong: the same
-- WORKFLOW_APPROVAL_REQUIRED type legitimately recurs for the same
-- subject/recipient/channel across a subject's lifetime, e.g. step 1's
-- then step 2's approval-required notification for the same PO and
-- approver — confirmed by a real constraint violation against live data
-- when first attempted unscoped). Gives Recruitment's own notifications
-- the same DB-backed idempotency Workflow's sourceEventId-keyed rows
-- already have.
CREATE UNIQUE INDEX "hr_recruitment_notifications_source_recipient_channel_key"
  ON "notifications" ("organisationId", "sourceType", "sourceId", "type", "recipientUserId", "channel")
  WHERE "sourceType" = 'INTERVIEW';
