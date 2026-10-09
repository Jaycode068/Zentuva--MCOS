import { WorkforceSummaryReportService } from './workforce-summary-report.service';

describe('WorkforceSummaryReportService', () => {
  function makeService(options: {
    byStatus?: { employmentStatus: string; count: number }[];
    byDepartment?: { departmentId: string | null; count: number }[];
    departments?: { id: string; name: string }[];
    attendanceGroups?: { status: string; _count: number }[];
  }) {
    const employeeService = {
      getHeadcountByStatus: jest.fn().mockResolvedValue(options.byStatus ?? []),
      getActiveHeadcountByDepartment: jest.fn().mockResolvedValue(options.byDepartment ?? []),
    };
    const prisma = {
      attendanceRecord: { groupBy: jest.fn().mockResolvedValue(options.attendanceGroups ?? []) },
      department: { findMany: jest.fn().mockResolvedValue(options.departments ?? []) },
    };
    return new WorkforceSummaryReportService(prisma as never, employeeService as never);
  }

  const from = new Date('2026-01-01T00:00:00Z');
  const to = new Date('2026-02-01T00:00:00Z');

  it('maps a null departmentId to an "Unassigned" bucket rather than dropping or mislabeling it', async () => {
    const service = makeService({
      byDepartment: [
        { departmentId: 'dept-1', count: 3 },
        { departmentId: null, count: 2 },
      ],
      departments: [{ id: 'dept-1', name: 'Production' }],
    });
    const report = await service.getReport('org-1', { from, to });
    const unassigned = report.byDepartment.find((row) => row.departmentId === null);
    expect(unassigned).toEqual({ departmentId: null, departmentName: 'Unassigned', count: 2 });
    const production = report.byDepartment.find((row) => row.departmentId === 'dept-1');
    expect(production?.departmentName).toBe('Production');
  });

  it('totalHeadcount is the sum of every status bucket, including non-ACTIVE ones', async () => {
    const service = makeService({
      byStatus: [
        { employmentStatus: 'ACTIVE', count: 10 },
        { employmentStatus: 'DRAFT', count: 2 },
        { employmentStatus: 'SEPARATED', count: 1 },
      ],
    });
    const report = await service.getReport('org-1', { from, to });
    expect(report.totalHeadcount).toBe(13);
    expect(report.activeHeadcount).toBe(10);
  });

  it('activeHeadcount is 0, not undefined/NaN, when there is no ACTIVE bucket at all', async () => {
    const service = makeService({ byStatus: [{ employmentStatus: 'DRAFT', count: 1 }] });
    const report = await service.getReport('org-1', { from, to });
    expect(report.activeHeadcount).toBe(0);
  });

  it('passes the attendance groupBy query the organisation-scoped [from, to) window', async () => {
    const employeeService = {
      getHeadcountByStatus: jest.fn().mockResolvedValue([]),
      getActiveHeadcountByDepartment: jest.fn().mockResolvedValue([]),
    };
    const groupBy = jest.fn().mockResolvedValue([]);
    const prisma = {
      attendanceRecord: { groupBy },
      department: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new WorkforceSummaryReportService(prisma as never, employeeService as never);
    await service.getReport('org-1', { from, to });
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organisationId: 'org-1', attendanceDate: { gte: from, lt: to } },
      }),
    );
  });
});
