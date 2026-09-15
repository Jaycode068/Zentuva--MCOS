-- CreateEnum
CREATE TYPE "WorkflowDefinitionStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "WorkflowInstanceStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "WorkflowStepInstanceStatus" AS ENUM ('PENDING', 'ACTIVE', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkflowDecisionType" AS ENUM ('APPROVE', 'REJECT', 'RETURN', 'CANCEL');

-- CreateTable
CREATE TABLE "workflow_definitions" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "subjectType" TEXT NOT NULL,
    "status" "WorkflowDefinitionStatus" NOT NULL DEFAULT 'INACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "allowSelfApproval" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_steps" (
    "id" TEXT NOT NULL,
    "workflowDefinitionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "requiredPermission" TEXT NOT NULL,
    "requiredScope" "AccessScope",
    "assignedUserId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_instances" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "workflowDefinitionId" TEXT NOT NULL,
    "workflowDefinitionVersion" INTEGER NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "status" "WorkflowInstanceStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_step_instances" (
    "id" TEXT NOT NULL,
    "workflowInstanceId" TEXT NOT NULL,
    "definitionStepId" TEXT,
    "stepNameSnapshot" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "requiredPermissionSnapshot" TEXT NOT NULL,
    "requiredScopeSnapshot" "AccessScope",
    "assignedUserIdSnapshot" TEXT,
    "status" "WorkflowStepInstanceStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_step_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_decisions" (
    "id" TEXT NOT NULL,
    "workflowInstanceId" TEXT NOT NULL,
    "workflowStepInstanceId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "decision" "WorkflowDecisionType" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_definitions_organisationId_idx" ON "workflow_definitions"("organisationId");

-- CreateIndex
CREATE INDEX "workflow_definitions_organisationId_subjectType_idx" ON "workflow_definitions"("organisationId", "subjectType");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_definitions_organisationId_code_key" ON "workflow_definitions"("organisationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_steps_workflowDefinitionId_code_key" ON "workflow_steps"("workflowDefinitionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_steps_workflowDefinitionId_sequence_key" ON "workflow_steps"("workflowDefinitionId", "sequence");

-- CreateIndex
CREATE INDEX "workflow_instances_organisationId_idx" ON "workflow_instances"("organisationId");

-- CreateIndex
CREATE INDEX "workflow_instances_organisationId_subjectType_subjectId_idx" ON "workflow_instances"("organisationId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "workflow_instances_organisationId_status_idx" ON "workflow_instances"("organisationId", "status");

-- CreateIndex
CREATE INDEX "workflow_instances_workflowDefinitionId_idx" ON "workflow_instances"("workflowDefinitionId");

-- CreateIndex
CREATE INDEX "workflow_step_instances_workflowInstanceId_idx" ON "workflow_step_instances"("workflowInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_step_instances_workflowInstanceId_sequence_key" ON "workflow_step_instances"("workflowInstanceId", "sequence");

-- CreateIndex
CREATE INDEX "workflow_decisions_workflowInstanceId_idx" ON "workflow_decisions"("workflowInstanceId");

-- CreateIndex
CREATE INDEX "workflow_decisions_workflowStepInstanceId_idx" ON "workflow_decisions"("workflowStepInstanceId");

-- AddForeignKey
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflowDefinitionId_fkey" FOREIGN KEY ("workflowDefinitionId") REFERENCES "workflow_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_workflowDefinitionId_fkey" FOREIGN KEY ("workflowDefinitionId") REFERENCES "workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_step_instances" ADD CONSTRAINT "workflow_step_instances_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_step_instances" ADD CONSTRAINT "workflow_step_instances_definitionStepId_fkey" FOREIGN KEY ("definitionStepId") REFERENCES "workflow_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_decisions" ADD CONSTRAINT "workflow_decisions_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_decisions" ADD CONSTRAINT "workflow_decisions_workflowStepInstanceId_fkey" FOREIGN KEY ("workflowStepInstanceId") REFERENCES "workflow_step_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
