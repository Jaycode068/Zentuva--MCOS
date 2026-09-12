import { Injectable } from '@nestjs/common';
import { Position, PositionStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListPositionsParams {
  status?: PositionStatus;
  departmentId?: string;
}

export interface CreatePositionData {
  organisationId: string;
  code: string;
  title: string;
  description?: string;
  departmentId?: string;
  reportsToPositionId?: string;
  createdById: string;
}

export interface CreatePositionResult {
  position: Position;
  wasCreated: boolean;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class PositionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<Position | null> {
    return this.prisma.position.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListPositionsParams = {},
  ): Promise<Position[]> {
    return this.prisma.position.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.departmentId ? { departmentId: params.departmentId } : {}),
      },
      orderBy: { code: 'asc' },
    });
  }

  countEmployees(organisationId: string, positionId: string): Promise<number> {
    return this.prisma.employee.count({ where: { organisationId, positionId } });
  }

  async getParentId(id: string): Promise<string | null> {
    const position = await this.prisma.position.findUnique({
      where: { id },
      select: { reportsToPositionId: true },
    });
    return position?.reportsToPositionId ?? null;
  }

  async create(data: CreatePositionData): Promise<CreatePositionResult> {
    try {
      const position = await this.prisma.position.create({
        data: {
          organisationId: data.organisationId,
          code: data.code,
          title: data.title,
          description: data.description,
          departmentId: data.departmentId,
          reportsToPositionId: data.reportsToPositionId,
          createdById: data.createdById,
        },
      });
      return { position, wasCreated: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        const existing = await this.prisma.position.findFirst({
          where: { organisationId: data.organisationId, code: data.code },
        });
        if (existing) {
          return { position: existing, wasCreated: false };
        }
      }
      throw error;
    }
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.PositionUncheckedUpdateInput,
  ): Promise<Position | null> {
    return this.updateMatching(organisationId, id, data);
  }

  activate(organisationId: string, id: string): Promise<Position | null> {
    return this.updateMatching(organisationId, id, { status: PositionStatus.ACTIVE });
  }

  deactivate(organisationId: string, id: string): Promise<Position | null> {
    return this.updateMatching(organisationId, id, { status: PositionStatus.INACTIVE });
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.PositionUncheckedUpdateInput,
  ): Promise<Position | null> {
    const result = await this.prisma.position.updateMany({ where: { id, organisationId }, data });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.position.findUniqueOrThrow({ where: { id } });
  }
}
