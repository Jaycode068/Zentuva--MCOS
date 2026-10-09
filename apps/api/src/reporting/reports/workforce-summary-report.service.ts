import { Injectable } from '@nestjs/common';
import { AttendanceStatus, EmploymentStatus } from '@prisma/client';

import { EmployeeService } from '../../hr/employee.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface HeadcountByStatusRow {
  employmentStatus: EmploymentStatus;
  count: number;
}

export interface HeadcountByDepartmentRow {
  departmentId: string | null;
  departmentName: string;
  count: number;
}

export interface AttendanceStatusRow {
  status: AttendanceStatus;
  count: number;
}

export interface WorkforceSummaryReport {
  from: Date;
  to: Date;
  totalHeadcount: number;
  activeHeadcount: number;
  byStatus: HeadcountByStatusRow[];
  byDepartment: HeadcountByDepartmentRow[];
  attendanceByStatus: AttendanceStatusRow[];
}

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation. Headcount reuses
 * `EmployeeService.getHeadcountByStatus()`/`.getActiveHeadcountByDepartment()`
 * (Sprint 45's own new thin pass-throughs to the existing `EmployeeRepository`,
 * see `employee.repository.ts`) — never a second headcount calculation.
 *
 * Attendance aggregation is genuinely new (the audit confirmed no aggregation
 * service exists; `HrOverviewService`'s own "today" figure pages 1000 rows into
 * memory, a pattern deliberately NOT copied here) — a single `groupBy` over
 * `AttendanceRecord.attendanceDate`, which is itself always written as an
 * organisation-timezone day-bucket by `resolveAttendanceDate` (Sprint 24) at
 * sign-in time, so filtering by `[from, to)` here needs no further timezone
 * handling of its own.
 *
 * **Known, explicit exclusion**: `EmploymentStatus.ON_LEAVE` is never written by any
 * code path in this codebase (confirmed by audit) — leave itself has no model at
 * all. `byStatus` reports whatever `groupBy` actually returns (which will never
 * include a non-zero `ON_LEAVE` row), rather than fabricating a permanently-zero
 * placeholder row for a status nothing can ever occupy.
 */
@Injectable()
export class WorkforceSummaryReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeeService: EmployeeService,
  ) {}

  async getReport(
    organisationId: string,
    params: { from: Date; to: Date },
  ): Promise<WorkforceSummaryReport> {
    const [byStatus, byDepartmentRaw, attendanceGroups, departments] = await Promise.all([
      this.employeeService.getHeadcountByStatus(organisationId),
      this.employeeService.getActiveHeadcountByDepartment(organisationId),
      this.prisma.attendanceRecord.groupBy({
        by: ['status'],
        where: { organisationId, attendanceDate: { gte: params.from, lt: params.to } },
        _count: true,
      }),
      this.prisma.department.findMany({
        where: { organisationId },
        select: { id: true, name: true },
      }),
    ]);

    const departmentNameById = new Map(
      departments.map((department) => [department.id, department.name]),
    );
    const byDepartment: HeadcountByDepartmentRow[] = byDepartmentRaw.map((row) => ({
      departmentId: row.departmentId,
      departmentName: row.departmentId
        ? (departmentNameById.get(row.departmentId) ?? 'Unknown')
        : 'Unassigned',
      count: row.count,
    }));

    const totalHeadcount = byStatus.reduce((sum, row) => sum + row.count, 0);
    const activeHeadcount = byStatus.find((row) => row.employmentStatus === 'ACTIVE')?.count ?? 0;

    return {
      from: params.from,
      to: params.to,
      totalHeadcount,
      activeHeadcount,
      byStatus,
      byDepartment,
      attendanceByStatus: attendanceGroups.map((row) => ({
        status: row.status,
        count: row._count,
      })),
    };
  }
}
