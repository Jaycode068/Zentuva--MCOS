import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Position } from '@prisma/client';
import { CreatePositionInput, UpdatePositionInput } from '@zentuva/validation';

import { DepartmentRepository } from './department.repository';
import { wouldCreateCycle } from './hr-hierarchy.util';
import {
  CreatePositionResult,
  ListPositionsParams,
  PositionRepository,
} from './position.repository';

@Injectable()
export class PositionService {
  constructor(
    private readonly positionRepository: PositionRepository,
    private readonly departmentRepository: DepartmentRepository,
  ) {}

  getById(organisationId: string, id: string): Promise<Position> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListPositionsParams): Promise<Position[]> {
    return this.positionRepository.findManyByOrganisation(organisationId, params);
  }

  countEmployees(organisationId: string, id: string): Promise<number> {
    return this.positionRepository.countEmployees(organisationId, id);
  }

  async create(
    organisationId: string,
    input: CreatePositionInput,
    actorUserId: string,
  ): Promise<CreatePositionResult> {
    if (input.departmentId) {
      await this.assertValidDepartment(organisationId, input.departmentId);
    }
    if (input.reportsToPositionId) {
      await this.assertValidReportsTo(organisationId, undefined, input.reportsToPositionId);
    }
    return this.positionRepository.create({
      organisationId,
      code: input.code,
      title: input.title,
      description: input.description,
      departmentId: input.departmentId,
      reportsToPositionId: input.reportsToPositionId,
      createdById: actorUserId,
    });
  }

  async update(organisationId: string, id: string, input: UpdatePositionInput): Promise<Position> {
    await this.getByIdOrThrow(organisationId, id);

    if (input.departmentId) {
      await this.assertValidDepartment(organisationId, input.departmentId);
    }
    if (input.reportsToPositionId) {
      await this.assertValidReportsTo(organisationId, id, input.reportsToPositionId);
    }

    const updated = await this.positionRepository.update(organisationId, id, {
      title: input.title,
      description: input.description,
      departmentId: input.departmentId,
      reportsToPositionId: input.reportsToPositionId,
    });
    if (!updated) {
      throw new NotFoundException('Position not found');
    }
    return updated;
  }

  async activate(organisationId: string, id: string): Promise<Position> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.positionRepository.activate(organisationId, id);
    if (!updated) {
      throw new NotFoundException('Position not found');
    }
    return updated;
  }

  async deactivate(organisationId: string, id: string): Promise<Position> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.positionRepository.deactivate(organisationId, id);
    if (!updated) {
      throw new NotFoundException('Position not found');
    }
    return updated;
  }

  private async assertValidDepartment(organisationId: string, departmentId: string): Promise<void> {
    const department = await this.departmentRepository.findById(organisationId, departmentId);
    if (!department) {
      throw new BadRequestException('Department not found in this organisation');
    }
  }

  private async assertValidReportsTo(
    organisationId: string,
    id: string | undefined,
    reportsToPositionId: string,
  ): Promise<void> {
    if (id && reportsToPositionId === id) {
      throw new BadRequestException('A position cannot report to itself');
    }
    const target = await this.positionRepository.findById(organisationId, reportsToPositionId);
    if (!target) {
      throw new BadRequestException('Reports-to position not found in this organisation');
    }
    if (id) {
      const cycle = await wouldCreateCycle(
        (nodeId) => this.positionRepository.getParentId(nodeId),
        id,
        reportsToPositionId,
      );
      if (cycle) {
        throw new BadRequestException('This would create a circular position hierarchy');
      }
    }
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<Position> {
    const position = await this.positionRepository.findById(organisationId, id);
    if (!position) {
      throw new NotFoundException('Position not found');
    }
    return position;
  }
}
