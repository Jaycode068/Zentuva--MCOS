import { Injectable } from '@nestjs/common';

import { AuditService } from '../identity/audit/audit.service';
import { DepartmentRepository } from './department.repository';
import { EmployeeOnboardingRepository } from './employee-onboarding.repository';
import { EmployeeRepository } from './employee.repository';

export interface HrOverview {
  totalEmployees: number;
  activeEmployees: number;
  onboardingEmployees: number;
  employeesWithoutUser: number;
  departmentCount: number;
  openOnboardingTasks: number;
  recentActivity: {
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    actorUserId: string | null;
    createdAt: Date;
  }[];
}

/** Read-only composition over Department/Employee/Onboarding repositories
 *  and the shared `AuditLog` table — no repository of its own, the exact
 *  `MaintenanceOverviewService` pattern (no persisted snapshot, every
 *  figure derived live). */
@Injectable()
export class HrOverviewService {
  constructor(
    private readonly employeeRepository: EmployeeRepository,
    private readonly departmentRepository: DepartmentRepository,
    private readonly onboardingRepository: EmployeeOnboardingRepository,
    private readonly auditService: AuditService,
  ) {}

  async getOverview(organisationId: string): Promise<HrOverview> {
    const [
      totalEmployees,
      activeEmployees,
      onboardingEmployees,
      employeesWithoutUser,
      departments,
      openOnboardingTasks,
      recentEvents,
    ] = await Promise.all([
      this.employeeRepository.count(organisationId),
      this.employeeRepository.count(organisationId, { employmentStatus: 'ACTIVE' }),
      this.employeeRepository.count(organisationId, { employmentStatus: 'ONBOARDING' }),
      this.employeeRepository.count(organisationId, { unlinkedOnly: true }),
      this.departmentRepository.findManyByOrganisation(organisationId, { status: 'ACTIVE' }),
      this.onboardingRepository.countOpenTasks(organisationId),
      this.auditService.listByOrganisation(organisationId, { take: 200 }),
    ]);

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
      recentActivity,
    };
  }
}
