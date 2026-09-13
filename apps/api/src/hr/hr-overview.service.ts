import { Injectable } from '@nestjs/common';

import { AuditService } from '../identity/audit/audit.service';
import { AttendanceRepository } from './attendance.repository';
import { DepartmentRepository } from './department.repository';
import { EmployeeOnboardingRepository } from './employee-onboarding.repository';
import { EmployeeRepository } from './employee.repository';
import { EmployeeTrainingRepository } from './employee-training.repository';
import { resolveAttendanceDate } from './hr-attendance-date.util';
import { OrganisationService } from '../identity/organisation/organisation.service';
import { PolicyAcknowledgementRepository } from './policy-acknowledgement.repository';
import { PolicyRepository } from './policy.repository';

export interface HrOverview {
  totalEmployees: number;
  activeEmployees: number;
  onboardingEmployees: number;
  employeesWithoutUser: number;
  departmentCount: number;
  openOnboardingTasks: number;
  attendanceToday: {
    present: number;
    late: number;
    pendingReview: number;
  };
  attendanceRequiringReview: number;
  pendingPolicyAcknowledgements: number;
  activeTrainingAssignments: number;
  overdueTrainingAssignments: number;
  recentActivity: {
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    actorUserId: string | null;
    createdAt: Date;
  }[];
}

/** Read-only composition over Department/Employee/Onboarding/Attendance/
 *  Policy/Training repositories and the shared `AuditLog` table — no
 *  repository of its own, the exact `MaintenanceOverviewService` pattern
 *  (no persisted snapshot, every figure derived live). Sprint 24 adds
 *  attendance/policy/training figures — no absenteeism rate, productivity,
 *  or KPI score is fabricated: every number here has a defensible, exact
 *  denominator (see docs/domains/hr.md "People Operations Overview"). */
@Injectable()
export class HrOverviewService {
  constructor(
    private readonly employeeRepository: EmployeeRepository,
    private readonly departmentRepository: DepartmentRepository,
    private readonly onboardingRepository: EmployeeOnboardingRepository,
    private readonly attendanceRepository: AttendanceRepository,
    private readonly policyRepository: PolicyRepository,
    private readonly policyAcknowledgementRepository: PolicyAcknowledgementRepository,
    private readonly employeeTrainingRepository: EmployeeTrainingRepository,
    private readonly organisationService: OrganisationService,
    private readonly auditService: AuditService,
  ) {}

  async getOverview(organisationId: string): Promise<HrOverview> {
    const organisation = await this.organisationService.getById(organisationId);
    const timeZone = organisation?.timeZone ?? 'UTC';
    const today = resolveAttendanceDate(new Date(), timeZone);

    await this.employeeTrainingRepository.syncOverdue(organisationId);

    const [
      totalEmployees,
      activeEmployees,
      onboardingEmployees,
      employeesWithoutUser,
      departments,
      openOnboardingTasks,
      todayAttendance,
      attendanceRequiringReview,
      activeTrainingAssignments,
      overdueTrainingAssignments,
      recentEvents,
    ] = await Promise.all([
      this.employeeRepository.count(organisationId),
      this.employeeRepository.count(organisationId, { employmentStatus: 'ACTIVE' }),
      this.employeeRepository.count(organisationId, { employmentStatus: 'ONBOARDING' }),
      this.employeeRepository.count(organisationId, { unlinkedOnly: true }),
      this.departmentRepository.findManyByOrganisation(organisationId, { status: 'ACTIVE' }),
      this.onboardingRepository.countOpenTasks(organisationId),
      this.attendanceRepository.findManyPaginated(organisationId, {
        page: 1,
        pageSize: 1000,
        dateFrom: today,
        dateTo: today,
      }),
      this.attendanceRepository.findManyPaginated(organisationId, {
        page: 1,
        pageSize: 1,
        reviewStatus: 'REQUIRES_CORRECTION',
      }),
      this.employeeTrainingRepository.findManyPaginated(organisationId, {
        page: 1,
        pageSize: 1,
        status: 'ASSIGNED',
      }),
      this.employeeTrainingRepository.findManyPaginated(organisationId, {
        page: 1,
        pageSize: 1,
        status: 'OVERDUE',
      }),
      this.auditService.listByOrganisation(organisationId, { take: 200 }),
    ]);

    const pendingPolicyAcknowledgements = await this.countPendingAcknowledgements(
      organisationId,
      totalEmployees,
    );

    const recentActivity = recentEvents
      .filter((event) => event.action.startsWith('hr.'))
      .slice(0, 10)
      .map((event) => ({
        id: event.id,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        actorUserId: event.actorUserId,
        createdAt: event.createdAt,
      }));

    return {
      totalEmployees,
      activeEmployees,
      onboardingEmployees,
      employeesWithoutUser,
      departmentCount: departments.length,
      openOnboardingTasks,
      attendanceToday: {
        present: todayAttendance.items.filter((record) => record.status === 'PRESENT').length,
        late: todayAttendance.items.filter((record) => record.status === 'LATE').length,
        pendingReview: todayAttendance.items.filter((record) => record.status === 'PENDING_REVIEW')
          .length,
      },
      attendanceRequiringReview: attendanceRequiringReview.total,
      pendingPolicyAcknowledgements,
      activeTrainingAssignments: activeTrainingAssignments.total,
      overdueTrainingAssignments: overdueTrainingAssignments.total,
      recentActivity,
    };
  }

  /** "Pending acknowledgements" = employees who have not yet acknowledged
   *  the current PUBLISHED version of a policy that `requiresAcknowledgement`
   *  — summed per such policy. A defensible denominator (active employees ×
   *  policies requiring acknowledgement), never a fabricated rate. */
  private async countPendingAcknowledgements(
    organisationId: string,
    totalEmployees: number,
  ): Promise<number> {
    const policies = await this.policyRepository.findManyByOrganisation(organisationId, {
      status: 'ACTIVE',
    });
    let pending = 0;
    for (const policy of policies) {
      const published = await this.policyRepository.findPublishedVersion(organisationId, policy.id);
      if (!published || !published.requiresAcknowledgement) {
        continue;
      }
      const acknowledgements = await this.policyAcknowledgementRepository.findManyByPolicyVersion(
        organisationId,
        published.id,
      );
      pending += Math.max(totalEmployees - acknowledgements.length, 0);
    }
    return pending;
  }
}
