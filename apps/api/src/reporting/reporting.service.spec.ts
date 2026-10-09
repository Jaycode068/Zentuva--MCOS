import { ForbiddenException } from '@nestjs/common';

import { ReportingService } from './reporting.service';

function makeAccess(overrides: { isOwnerBypass?: boolean; grantedKeys?: string[] } = {}) {
  return {
    isOwnerBypass: overrides.isOwnerBypass ?? false,
    grants: new Map((overrides.grantedKeys ?? []).map((key) => [key, {} as never])),
  };
}

describe('ReportingService', () => {
  function makeService(access: ReturnType<typeof makeAccess>) {
    const organisationService = { getById: jest.fn().mockResolvedValue({ timeZone: 'UTC' }) };
    const effectiveAccessResolver = { resolve: jest.fn().mockResolvedValue(access) };
    const receivablesReportService = {
      getReport: jest.fn().mockResolvedValue({ receivables: true }),
    };
    const payablesReportService = { getReport: jest.fn().mockResolvedValue({ payables: true }) };
    const inventoryPositionReportService = {
      getReport: jest.fn().mockResolvedValue({ inventory: true }),
    };
    const salesPerformanceReportService = {
      getReport: jest.fn().mockResolvedValue({ sales: true }),
    };
    const productionPerformanceReportService = {
      getReport: jest.fn().mockResolvedValue({ production: true }),
    };
    const workforceSummaryReportService = {
      getReport: jest.fn().mockResolvedValue({ workforce: true }),
    };
    const operationalExceptionsReportService = {
      getPendingApprovals: jest.fn().mockResolvedValue([{ id: 'approval-1' }]),
      getOverdueMaintenanceCount: jest.fn().mockResolvedValue(3),
      getFailedNotificationCounts: jest.fn().mockResolvedValue({ email: 1, whatsapp: 2 }),
    };

    const service = new ReportingService(
      organisationService as never,
      effectiveAccessResolver as never,
      receivablesReportService as never,
      payablesReportService as never,
      inventoryPositionReportService as never,
      salesPerformanceReportService as never,
      productionPerformanceReportService as never,
      workforceSummaryReportService as never,
      operationalExceptionsReportService as never,
    );

    return {
      service,
      receivablesReportService,
      operationalExceptionsReportService,
    };
  }

  describe('getCatalogue', () => {
    it('Owner bypass sees every metric and report, regardless of grants', async () => {
      const { service } = makeService(makeAccess({ isOwnerBypass: true }));
      const catalogue = await service.getCatalogue('org-1', 'user-1');
      expect(catalogue.metrics.length).toBeGreaterThan(0);
      expect(catalogue.reports.length).toBeGreaterThan(0);
    });

    it('a user with zero grants sees zero metrics and zero reports — never a default-visible item', async () => {
      const { service } = makeService(makeAccess({ grantedKeys: [] }));
      const catalogue = await service.getCatalogue('org-1', 'user-1');
      expect(catalogue.metrics).toEqual([]);
      expect(catalogue.reports).toEqual([]);
    });

    it('a user with exactly one domain permission sees only the items requiring it', async () => {
      const { service } = makeService(makeAccess({ grantedKeys: ['sales.dashboard.view'] }));
      const catalogue = await service.getCatalogue('org-1', 'user-1');
      expect(
        catalogue.reports.every((report) => report.requiredPermission === 'sales.dashboard.view'),
      ).toBe(true);
      expect(catalogue.reports.some((report) => report.id === 'sales-performance')).toBe(true);
      expect(catalogue.reports.some((report) => report.id === 'receivables')).toBe(false);
    });
  });

  describe('permission enforcement on individual reports', () => {
    it("throws ForbiddenException when the caller lacks the report's own required permission", async () => {
      const { service } = makeService(makeAccess({ grantedKeys: [] }));
      await expect(service.getReceivables('org-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });

    it('succeeds and delegates to the report service when the caller holds the required permission', async () => {
      const { service, receivablesReportService } = makeService(
        makeAccess({ grantedKeys: ['finance.reports.view'] }),
      );
      const result = await service.getReceivables('org-1', 'user-1');
      expect(result).toEqual({ receivables: true });
      expect(receivablesReportService.getReport).toHaveBeenCalledWith('org-1');
    });

    it('Owner bypass succeeds even with zero explicit grants', async () => {
      const { service } = makeService(makeAccess({ isOwnerBypass: true }));
      await expect(service.getPayables('org-1', 'user-1')).resolves.toEqual({ payables: true });
    });
  });

  describe('getOperationalExceptions — independent per-section permission gating', () => {
    it('a caller with ALL three section permissions sees every section populated', async () => {
      const { service } = makeService(
        makeAccess({
          grantedKeys: [
            'workflow.instance.view',
            'maintenance.work_order.view',
            'notification.email.view',
            'notification.whatsapp.view',
          ],
        }),
      );
      const result = await service.getOperationalExceptions('org-1', 'user-1');
      expect(result.pendingApprovals).toEqual([{ id: 'approval-1' }]);
      expect(result.overdueMaintenanceCount).toBe(3);
      expect(result.failedNotifications).toEqual({ email: 1, whatsapp: 2 });
    });

    it('a caller with NO section permissions gets every section as null, never a 403 for the whole report', async () => {
      const { service } = makeService(makeAccess({ grantedKeys: [] }));
      const result = await service.getOperationalExceptions('org-1', 'user-1');
      expect(result).toEqual({
        pendingApprovals: null,
        overdueMaintenanceCount: null,
        failedNotifications: null,
      });
    });

    it('a caller with ONLY workflow.instance.view sees pendingApprovals but not the other two sections', async () => {
      const { service, operationalExceptionsReportService } = makeService(
        makeAccess({ grantedKeys: ['workflow.instance.view'] }),
      );
      const result = await service.getOperationalExceptions('org-1', 'user-1');
      expect(result.pendingApprovals).toEqual([{ id: 'approval-1' }]);
      expect(result.overdueMaintenanceCount).toBeNull();
      expect(result.failedNotifications).toBeNull();
      // The maintenance/notification queries are never even attempted for a caller
      // who cannot see their result — not just filtered out after the fact.
      expect(operationalExceptionsReportService.getOverdueMaintenanceCount).not.toHaveBeenCalled();
      expect(operationalExceptionsReportService.getFailedNotificationCounts).not.toHaveBeenCalled();
    });

    it('failedNotifications requires BOTH notification.email.view AND notification.whatsapp.view — holding only one omits the section', async () => {
      const { service } = makeService(makeAccess({ grantedKeys: ['notification.email.view'] }));
      const result = await service.getOperationalExceptions('org-1', 'user-1');
      expect(result.failedNotifications).toBeNull();
    });
  });
});
