import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Department } from '@prisma/client';
import { CreateDepartmentInput, UpdateDepartmentInput } from '@zentuva/validation';

import { EmployeeRepository } from './employee.repository';
import {
  CreateDepartmentResult,
  DepartmentRepository,
  ListDepartmentsParams,
} from './department.repository';
import { wouldCreateCycle } from './hr-hierarchy.util';

@Injectable()
export class DepartmentService {
  constructor(
    private readonly departmentRepository: DepartmentRepository,
    private readonly employeeRepository: EmployeeRepository,
  ) {}

  getById(organisationId: string, id: string): Promise<Department> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListDepartmentsParams): Promise<Department[]> {
    return this.departmentRepository.findManyByOrganisation(organisationId, params);
  }

  countEmployees(organisationId: string, id: string): Promise<number> {
    return this.departmentRepository.countEmployees(organisationId, id);
  }

  async create(
    organisationId: string,
    input: CreateDepartmentInput,
    actorUserId: string,
  ): Promise<CreateDepartmentResult> {
    if (input.parentDepartmentId) {
      await this.assertValidParent(organisationId, undefined, input.parentDepartmentId);
    }
    if (input.departmentHeadEmployeeId) {
      await this.assertValidHead(organisationId, input.departmentHeadEmployeeId);
    }
    return this.departmentRepository.create({
      organisationId,
      code: input.code,
      name: input.name,
      description: input.description,
      parentDepartmentId: input.parentDepartmentId,
      departmentHeadEmployeeId: input.departmentHeadEmployeeId,
      createdById: actorUserId,
    });
  }

  async update(
    organisationId: string,
    id: string,
    input: UpdateDepartmentInput,
  ): Promise<Department> {
    await this.getByIdOrThrow(organisationId, id);

    if (input.parentDepartmentId) {
      await this.assertValidParent(organisationId, id, input.parentDepartmentId);
    }
    if (input.departmentHeadEmployeeId) {
      await this.assertValidHead(organisationId, input.departmentHeadEmployeeId);
    }

    const updated = await this.departmentRepository.update(organisationId, id, {
      name: input.name,
      description: input.description,
      parentDepartmentId: input.parentDepartmentId,
      departmentHeadEmployeeId: input.departmentHeadEmployeeId,
    });
    if (!updated) {
      throw new NotFoundException('Department not found');
    }
    return updated;
  }

  async activate(organisationId: string, id: string): Promise<Department> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.departmentRepository.activate(organisationId, id);
    if (!updated) {
      throw new NotFoundException('Department not found');
    }
    return updated;
  }

  async deactivate(organisationId: string, id: string): Promise<Department> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.departmentRepository.deactivate(organisationId, id);
    if (!updated) {
      throw new NotFoundException('Department not found');
    }
    return updated;
  }

  private async assertValidParent(
    organisationId: string,
    id: string | undefined,
    parentDepartmentId: string,
  ): Promise<void> {
    if (id && parentDepartmentId === id) {
      throw new BadRequestException('A department cannot be its own parent');
    }
    const parent = await this.departmentRepository.findById(organisationId, parentDepartmentId);
    if (!parent) {
      throw new BadRequestException('Parent department not found in this organisation');
    }
    if (id) {
      const cycle = await wouldCreateCycle(
        (nodeId) => this.departmentRepository.getParentId(nodeId),
        id,
        parentDepartmentId,
      );
      if (cycle) {
        throw new BadRequestException('This would create a circular department hierarchy');
      }
    }
  }

  private async assertValidHead(
    organisationId: string,
    departmentHeadEmployeeId: string,
  ): Promise<void> {
    const head = await this.employeeRepository.findById(organisationId, departmentHeadEmployeeId);
    if (!head) {
      throw new BadRequestException('Department head must be an employee in this organisation');
    }
    if (head.employmentStatus === 'SEPARATED') {
      throw new BadRequestException('Department head cannot be a separated employee');
    }
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<Department> {
    const department = await this.departmentRepository.findById(organisationId, id);
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    return department;
  }
}
