import { Injectable } from '@nestjs/common';

import { MaintenanceOverviewService } from '../../maintenance/maintenance-overview.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface PendingApprovalRow {
  workflowInstanceId: string;
  subjectType: string;
  subjectId: string;
  stepName: string;
  startedAt: Date | null;
  ageDays: number;
  dueAt: Date | null;
  isOverdue: boolean;
}

export interface FailedNotificationCounts {
  email: number;
  whatsapp: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation (docs/domains/reporting.md
 * "Operational Exceptions"). A composite of three INDEPENDENT sections, each gated by
 * its own existing domain permission at the controller/orchestration layer (brief §10
 * — "do not grant broad visibility merely because a user can access a general
 * dashboard"): this service exposes one method per section rather than one combined
 * `getReport()`, so a caller lacking a section's permission never even triggers that
 * section's query.
 *
 * **Pending approvals** is genuinely new — the audit found the existing
 * `WorkflowInstanceService.listMyApprovals` is per-user and does an eligibility
 * N+1 loop, unsuitable as a reporting primitive at scale (and answering a different
 * question: "what can THIS user act on" vs. "what is pending org-wide"). This method
 * is a narrow, direct, read-only `WorkflowStepInstance` read — the same "documented
 * exception" shape Finance's own reports already use for `InventoryStock` — scoped to
 * `status: 'ACTIVE'` (awaiting action), with ageing computed from `startedAt`.
 *
 * **Overdue maintenance** reuses `MaintenanceOverviewService.getOverview()` verbatim
 * (`overdueWorkOrders`) — never recomputed.
 *
 * **Failed notifications** is a narrow, direct `EmailDelivery`/`WhatsAppDelivery`
 * count — mirroring the `countSinceByStatus` idiom the D2C messaging module already
 * established, generalized here to the two non-D2C channel tables (D2C's own failed-
 * notification exceptions are already surfaced by the existing
 * `D2COperationalExceptionsService` — not duplicated here, see
 * docs/domains/reporting.md "D2C").
 */
@Injectable()
export class OperationalExceptionsReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly maintenanceOverviewService: MaintenanceOverviewService,
  ) {}

  async getPendingApprovals(
    organisationId: string,
    now: Date = new Date(),
  ): Promise<PendingApprovalRow[]> {
    const steps = await this.prisma.workflowStepInstance.findMany({
      where: { status: 'ACTIVE', workflowInstance: { organisationId } },
      select: {
        stepNameSnapshot: true,
        startedAt: true,
        workflowInstance: {
          select: { id: true, subjectType: true, subjectId: true, dueAt: true },
        },
      },
      orderBy: { startedAt: 'asc' },
    });

    return steps.map((step) => {
      const ageDays = step.startedAt
        ? Math.floor((now.getTime() - step.startedAt.getTime()) / DAY_MS)
        : 0;
      const dueAt = step.workflowInstance.dueAt;
      return {
        workflowInstanceId: step.workflowInstance.id,
        subjectType: step.workflowInstance.subjectType,
        subjectId: step.workflowInstance.subjectId,
        stepName: step.stepNameSnapshot,
        startedAt: step.startedAt,
        ageDays,
        dueAt,
        isOverdue: dueAt != null && dueAt.getTime() < now.getTime(),
      };
    });
  }

  async getOverdueMaintenanceCount(organisationId: string): Promise<number> {
    const overview = await this.maintenanceOverviewService.getOverview(organisationId);
    return overview.overdueWorkOrders;
  }

  async getFailedNotificationCounts(organisationId: string): Promise<FailedNotificationCounts> {
    const [email, whatsapp] = await Promise.all([
      this.prisma.emailDelivery.count({ where: { organisationId, status: 'FAILED' } }),
      this.prisma.whatsAppDelivery.count({ where: { organisationId, status: 'FAILED' } }),
    ]);
    return { email, whatsapp };
  }
}
