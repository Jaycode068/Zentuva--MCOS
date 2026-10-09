import { OperationalExceptionsReportService } from './operational-exceptions-report.service';

describe('OperationalExceptionsReportService', () => {
  function makeService(steps: unknown[]) {
    const prisma = {
      workflowStepInstance: { findMany: jest.fn().mockResolvedValue(steps) },
      emailDelivery: { count: jest.fn().mockResolvedValue(2) },
      whatsAppDelivery: { count: jest.fn().mockResolvedValue(5) },
    };
    const maintenanceOverviewService = {
      getOverview: jest.fn().mockResolvedValue({ overdueWorkOrders: 7 }),
    };
    const service = new OperationalExceptionsReportService(
      prisma as never,
      maintenanceOverviewService as never,
    );
    return { service, prisma, maintenanceOverviewService };
  }

  describe('getPendingApprovals', () => {
    it('computes ageDays as whole days elapsed since startedAt', async () => {
      const now = new Date('2026-03-10T00:00:00Z');
      const { service } = makeService([
        {
          stepNameSnapshot: 'Manager Approval',
          startedAt: new Date('2026-03-05T00:00:00Z'),
          workflowInstance: {
            id: 'wf-1',
            subjectType: 'PURCHASE_ORDER',
            subjectId: 'po-1',
            dueAt: null,
          },
        },
      ]);
      const rows = await service.getPendingApprovals('org-1', now);
      expect(rows[0]!.ageDays).toBe(5);
    });

    it('ageDays is 0, not NaN, when startedAt is null', async () => {
      const { service } = makeService([
        {
          stepNameSnapshot: 'Manager Approval',
          startedAt: null,
          workflowInstance: {
            id: 'wf-1',
            subjectType: 'PURCHASE_ORDER',
            subjectId: 'po-1',
            dueAt: null,
          },
        },
      ]);
      const rows = await service.getPendingApprovals('org-1');
      expect(rows[0]!.ageDays).toBe(0);
    });

    it('isOverdue is true only when dueAt is set AND in the past', async () => {
      const now = new Date('2026-03-10T00:00:00Z');
      const { service } = makeService([
        {
          stepNameSnapshot: 'A',
          startedAt: now,
          workflowInstance: {
            id: 'wf-1',
            subjectType: 'X',
            subjectId: '1',
            dueAt: new Date('2026-03-01T00:00:00Z'),
          },
        },
        {
          stepNameSnapshot: 'B',
          startedAt: now,
          workflowInstance: {
            id: 'wf-2',
            subjectType: 'X',
            subjectId: '2',
            dueAt: new Date('2026-03-20T00:00:00Z'),
          },
        },
        {
          stepNameSnapshot: 'C',
          startedAt: now,
          workflowInstance: { id: 'wf-3', subjectType: 'X', subjectId: '3', dueAt: null },
        },
      ]);
      const rows = await service.getPendingApprovals('org-1', now);
      expect(rows[0]!.isOverdue).toBe(true); // due in the past
      expect(rows[1]!.isOverdue).toBe(false); // due in the future
      expect(rows[2]!.isOverdue).toBe(false); // no due date configured — never treated as overdue
    });

    it("scopes to status ACTIVE within the caller's organisation via the WorkflowInstance relation", async () => {
      const { service, prisma } = makeService([]);
      await service.getPendingApprovals('org-1');
      expect(prisma.workflowStepInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'ACTIVE', workflowInstance: { organisationId: 'org-1' } },
        }),
      );
    });
  });

  describe('getOverdueMaintenanceCount', () => {
    it('reuses MaintenanceOverviewService.getOverview().overdueWorkOrders verbatim', async () => {
      const { service, maintenanceOverviewService } = makeService([]);
      const count = await service.getOverdueMaintenanceCount('org-1');
      expect(count).toBe(7);
      expect(maintenanceOverviewService.getOverview).toHaveBeenCalledWith('org-1');
    });
  });

  describe('getFailedNotificationCounts', () => {
    it('counts FAILED rows independently for email and whatsapp, scoped to the organisation', async () => {
      const { service, prisma } = makeService([]);
      const counts = await service.getFailedNotificationCounts('org-1');
      expect(counts).toEqual({ email: 2, whatsapp: 5 });
      expect(prisma.emailDelivery.count).toHaveBeenCalledWith({
        where: { organisationId: 'org-1', status: 'FAILED' },
      });
      expect(prisma.whatsAppDelivery.count).toHaveBeenCalledWith({
        where: { organisationId: 'org-1', status: 'FAILED' },
      });
    });
  });
});
