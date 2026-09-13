import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Employee, EmploymentStatus } from '@prisma/client';
import { CreateEmployeeInput, UpdateEmployeeInput } from '@zentuva/validation';

import { UserService } from '../identity/user/user.service';
import { DepartmentRepository } from './department.repository';
import { WorkScheduleRepository } from './work-schedule.repository';
import {
  CreateEmployeeData,
  EmployeeRepository,
  ListEmployeesParams,
  ListEmployeesResult,
} from './employee.repository';
import { wouldCreateCycle } from './hr-hierarchy.util';
import { PositionRepository } from './position.repository';

const TERMINAL_STATUSES: EmploymentStatus[] = ['SEPARATED'];

export interface SeparateEmployeeData {
  separationDate: Date;
  separationReason?: string;
}

@Injectable()
export class EmployeeService {
  constructor(
    private readonly employeeRepository: EmployeeRepository,
    private readonly departmentRepository: DepartmentRepository,
    private readonly positionRepository: PositionRepository,
    private readonly workScheduleRepository: WorkScheduleRepository,
    private readonly userService: UserService,
  ) {}

  getById(organisationId: string, id: string): Promise<Employee> {
    return this.getByIdOrThrow(organisationId, id);
  }

  async getByIdWithRelations(organisationId: string, id: string) {
    const employee = await this.employeeRepository.findByIdWithRelations(organisationId, id);
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    return employee;
  }

  list(
    organisationId: string,
    params: Partial<ListEmployeesParams> & { page?: number; pageSize?: number },
  ): Promise<ListEmployeesResult> {
    return this.employeeRepository.findManyPaginated(organisationId, {
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
      search: params.search,
      departmentId: params.departmentId,
      positionId: params.positionId,
      employmentType: params.employmentType,
      employmentStatus: params.employmentStatus,
      unlinkedOnly: params.unlinkedOnly,
    });
  }

  async create(
    organisationId: string,
    input: CreateEmployeeInput,
    actorUserId: string,
  ): Promise<Employee> {
    if (input.departmentId) {
      await this.assertDepartmentExists(organisationId, input.departmentId);
    }
    if (input.positionId) {
      await this.assertPositionExists(organisationId, input.positionId);
    }
    if (input.managerEmployeeId) {
      await this.assertValidManager(organisationId, undefined, input.managerEmployeeId);
    }

    const data: CreateEmployeeData = {
      organisationId,
      firstName: input.firstName,
      middleName: input.middleName,
      lastName: input.lastName,
      preferredName: input.preferredName,
      workEmail: input.workEmail,
      personalEmail: input.personalEmail,
      phoneNumber: input.phoneNumber,
      alternatePhoneNumber: input.alternatePhoneNumber,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      nationality: input.nationality,
      address: input.address,
      emergencyContactName: input.emergencyContactName,
      emergencyContactPhone: input.emergencyContactPhone,
      emergencyContactRelationship: input.emergencyContactRelationship,
      departmentId: input.departmentId,
      positionId: input.positionId,
      managerEmployeeId: input.managerEmployeeId,
      employmentType: input.employmentType,
      hireDate: input.hireDate,
      probationEndDate: input.probationEndDate,
      notes: input.notes,
      createdById: actorUserId,
    };
    return this.employeeRepository.create(data);
  }

  async update(organisationId: string, id: string, input: UpdateEmployeeInput): Promise<Employee> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.employeeRepository.update(organisationId, id, {
      firstName: input.firstName,
      middleName: input.middleName,
      lastName: input.lastName,
      preferredName: input.preferredName,
      workEmail: input.workEmail,
      personalEmail: input.personalEmail,
      phoneNumber: input.phoneNumber,
      alternatePhoneNumber: input.alternatePhoneNumber,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      nationality: input.nationality,
      address: input.address,
      emergencyContactName: input.emergencyContactName,
      emergencyContactPhone: input.emergencyContactPhone,
      emergencyContactRelationship: input.emergencyContactRelationship,
      employmentType: input.employmentType,
      hireDate: input.hireDate,
      probationEndDate: input.probationEndDate,
      confirmationDate: input.confirmationDate,
      notes: input.notes,
    });
    if (!updated) {
      throw new NotFoundException('Employee not found');
    }
    return updated;
  }

  async assignDepartment(
    organisationId: string,
    id: string,
    departmentId: string | null,
  ): Promise<Employee> {
    await this.getByIdOrThrow(organisationId, id);
    if (departmentId) {
      await this.assertDepartmentExists(organisationId, departmentId);
    }
    const updated = await this.employeeRepository.assignDepartment(
      organisationId,
      id,
      departmentId,
    );
    if (!updated) {
      throw new NotFoundException('Employee not found');
    }
    return updated;
  }

  async assignPosition(
    organisationId: string,
    id: string,
    positionId: string | null,
  ): Promise<Employee> {
    await this.getByIdOrThrow(organisationId, id);
    if (positionId) {
      await this.assertPositionExists(organisationId, positionId);
    }
    const updated = await this.employeeRepository.assignPosition(organisationId, id, positionId);
    if (!updated) {
      throw new NotFoundException('Employee not found');
    }
    return updated;
  }

  async assignManager(
    organisationId: string,
    id: string,
    managerEmployeeId: string | null,
  ): Promise<Employee> {
    await this.getByIdOrThrow(organisationId, id);
    if (managerEmployeeId) {
      await this.assertValidManager(organisationId, id, managerEmployeeId);
    }
    const updated = await this.employeeRepository.assignManager(
      organisationId,
      id,
      managerEmployeeId,
    );
    if (!updated) {
      throw new NotFoundException('Employee not found');
    }
    return updated;
  }

  async assignWorkSchedule(
    organisationId: string,
    id: string,
    workScheduleId: string | null,
  ): Promise<Employee> {
    await this.getByIdOrThrow(organisationId, id);
    if (workScheduleId) {
      const schedule = await this.workScheduleRepository.findById(organisationId, workScheduleId);
      if (!schedule) {
        throw new BadRequestException('Work schedule not found in this organisation');
      }
    }
    const updated = await this.employeeRepository.assignWorkSchedule(
      organisationId,
      id,
      workScheduleId,
    );
    if (!updated) {
      throw new NotFoundException('Employee not found');
    }
    return updated;
  }

  async linkUser(organisationId: string, id: string, userId: string): Promise<Employee> {
    await this.getByIdOrThrow(organisationId, id);

    const user = await this.userService.getById(organisationId, userId);
    if (!user) {
      throw new BadRequestException('User not found in this organisation');
    }

    const existingLink = await this.employeeRepository.findByUserId(organisationId, userId);
    if (existingLink && existingLink.id !== id) {
      throw new BadRequestException('This user is already linked to a different employee');
    }

    const { employee, conflict } = await this.employeeRepository.linkUser(
      organisationId,
      id,
      userId,
    );
    if (conflict) {
      throw new BadRequestException('This user is already linked to a different employee');
    }
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    return employee;
  }

  async unlinkUser(organisationId: string, id: string): Promise<Employee> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.employeeRepository.unlinkUser(organisationId, id);
    if (!updated) {
      throw new NotFoundException('Employee not found');
    }
    return updated;
  }

  /** DRAFT/ONBOARDING → ACTIVE. Soft-idempotent if already ACTIVE. */
  async activate(
    organisationId: string,
    id: string,
  ): Promise<{ employee: Employee; transitioned: boolean }> {
    return this.transition(organisationId, id, ['DRAFT', 'ONBOARDING'], 'ACTIVE', {});
  }

  /** ACTIVE → SUSPENDED. */
  async suspend(
    organisationId: string,
    id: string,
  ): Promise<{ employee: Employee; transitioned: boolean }> {
    return this.transition(organisationId, id, ['ACTIVE'], 'SUSPENDED', {});
  }

  /** SUSPENDED → ACTIVE — "reactivate" is deliberately narrower than
   *  `activate()`: only a suspended employee can be reactivated, never a
   *  separated one (separation is hard-terminal, see `TERMINAL_STATUSES`). */
  async reactivate(
    organisationId: string,
    id: string,
  ): Promise<{ employee: Employee; transitioned: boolean }> {
    return this.transition(organisationId, id, ['SUSPENDED'], 'ACTIVE', {});
  }

  /** Any non-terminal status → SEPARATED (hard-terminal). Records date/reason. */
  async separate(
    organisationId: string,
    id: string,
    data: SeparateEmployeeData,
  ): Promise<{ employee: Employee; transitioned: boolean }> {
    return this.transition(
      organisationId,
      id,
      ['DRAFT', 'ONBOARDING', 'ACTIVE', 'ON_LEAVE', 'SUSPENDED'],
      'SEPARATED',
      { separationDate: data.separationDate, separationReason: data.separationReason ?? null },
    );
  }

  private async transition(
    organisationId: string,
    id: string,
    fromStatuses: EmploymentStatus[],
    toStatus: EmploymentStatus,
    extraData: Record<string, unknown>,
  ): Promise<{ employee: Employee; transitioned: boolean }> {
    const employee = await this.getByIdOrThrow(organisationId, id);

    if (TERMINAL_STATUSES.includes(employee.employmentStatus)) {
      throw new BadRequestException(
        `Cannot change status of a ${employee.employmentStatus.toLowerCase()} employee — it is a terminal state`,
      );
    }
    if (employee.employmentStatus === toStatus) {
      return { employee, transitioned: false };
    }
    if (!fromStatuses.includes(employee.employmentStatus)) {
      throw new BadRequestException(
        `Cannot move an employee from ${employee.employmentStatus.toLowerCase()} to ${toStatus.toLowerCase()}`,
      );
    }

    const updated = await this.employeeRepository.setEmploymentStatus(organisationId, id, {
      employmentStatus: toStatus,
      ...extraData,
    });
    if (!updated) {
      throw new NotFoundException('Employee not found');
    }
    return { employee: updated, transitioned: true };
  }

  private async assertDepartmentExists(
    organisationId: string,
    departmentId: string,
  ): Promise<void> {
    const department = await this.departmentRepository.findById(organisationId, departmentId);
    if (!department) {
      throw new BadRequestException('Department not found in this organisation');
    }
  }

  private async assertPositionExists(organisationId: string, positionId: string): Promise<void> {
    const position = await this.positionRepository.findById(organisationId, positionId);
    if (!position) {
      throw new BadRequestException('Position not found in this organisation');
    }
  }

  private async assertValidManager(
    organisationId: string,
    id: string | undefined,
    managerEmployeeId: string,
  ): Promise<void> {
    if (id && managerEmployeeId === id) {
      throw new BadRequestException('An employee cannot report to themselves');
    }
    const manager = await this.employeeRepository.findById(organisationId, managerEmployeeId);
    if (!manager) {
      throw new BadRequestException('Manager not found in this organisation');
    }
    if (manager.employmentStatus === 'SEPARATED') {
      throw new BadRequestException('Cannot assign a separated employee as manager');
    }
    if (id) {
      const cycle = await wouldCreateCycle(
        (nodeId) => this.employeeRepository.getManagerId(nodeId),
        id,
        managerEmployeeId,
      );
      if (cycle) {
        throw new BadRequestException('This would create a circular reporting relationship');
      }
    }
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<Employee> {
    const employee = await this.employeeRepository.findById(organisationId, id);
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    return employee;
  }
}
