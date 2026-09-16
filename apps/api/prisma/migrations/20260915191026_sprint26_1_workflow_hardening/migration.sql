-- AlterEnum
ALTER TYPE "WorkflowInstanceStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "workflow_instances" ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "expiredAt" TIMESTAMP(3),
ADD COLUMN     "previousInstanceId" TEXT,
ADD COLUMN     "resubmissionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "resubmittedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "workflow_events" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "workflowInstanceId" TEXT NOT NULL,
    "workflowDefinitionId" TEXT NOT NULL,
    "workflowDefinitionVersion" INTEGER NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectReference" TEXT,
    "eventType" TEXT NOT NULL,
    "actorUserId" TEXT,
    "targetUserId" TEXT,
    "workflowStepInstanceId" TEXT,
    "correlationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "summary" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_events_organisationId_workflowInstanceId_idx" ON "workflow_events"("organisationId", "workflowInstanceId");

-- CreateIndex
CREATE INDEX "workflow_events_organisationId_eventType_idx" ON "workflow_events"("organisationId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_events_organisationId_idempotencyKey_key" ON "workflow_events"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "workflow_instances_previousInstanceId_idx" ON "workflow_instances"("previousInstanceId");

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_previousInstanceId_fkey" FOREIGN KEY ("previousInstanceId") REFERENCES "workflow_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sprint 26.1 hardening: close a genuine TOCTOU race found during this sprint's audit.
-- WorkflowInstanceService.create()/resubmit() check-then-act ("no other non-terminal
-- instance already targets this subject", then INSERT) with no DB-level guarantee in
-- between — two concurrent requests for the same subject could both pass the check and
-- both insert. Prisma's schema.prisma has no declarative "unique among a WHERE subset"
-- construct, so this partial unique index is hand-added directly in this migration
-- (docs/domains/workflow.md §12 "Concurrency & Idempotency"). It enforces, at the
-- database level, that a given (organisation, subject) can have at most one row whose
-- status is still non-terminal — the exact invariant the application code already
-- intended but could not itself guarantee under concurrency. A second concurrent
-- INSERT now fails with a unique-violation (Postgres code 23505), which
-- WorkflowInstanceRepository.createWithSteps() catches and the service layer surfaces
-- as 409 Conflict — never a silent duplicate active workflow.
CREATE UNIQUE INDEX "workflow_instances_one_active_per_subject"
ON "workflow_instances" ("organisationId", "subjectType", "subjectId")
WHERE "status" IN ('DRAFT', 'SUBMITTED', 'IN_PROGRESS');
