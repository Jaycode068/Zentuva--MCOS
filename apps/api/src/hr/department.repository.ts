import { Injectable } from '@nestjs/common';
import { Department, DepartmentStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListDepartmentsParams {
  status?: DepartmentStatus;
}

export interface CreateDepartmentData {
  organisationId: string;
  code: string;
  name: string;
  description?: string;
  parentDepartmentId?: string;
  departmentHeadEmployeeId?: string;
  createdById: string;
}

export interface CreateDepartmentResult {
  department: Department;
  wasCreated: boolean;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class DepartmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<Department | null> {
    return this.prisma.department.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListDepartmentsParams = {},
  ): Promise<Department[]> {
    return this.prisma.department.findMany({
      where: { organisationId, ...(params.status ? { status: params.status } : {}) },
      orderBy: { code: 'asc' },
    });
  }

  countEmployees(organisationId: string, departmentId: string): Promise<number> {
    return this.prisma.employee.count({ where: { organisationId, departmentId } });
  }

  async getParentId(id: string): Promise<string | null> {
    const department = await this.prisma.department.findUnique({
      where: { id },
      select: { parentDepartmentId: true },
    });
    return department?.parentDepartmentId ?? null;
  }

  async create(data: CreateDepartmentData): Promise<CreateDepartmentResult> {
    try {
      const department = await this.prisma.department.create({
        data: {
          organisationId: data.organisationId,
          code: data.code,
          name: data.name,
          description: data.description,
          parentDepartmentId: data.parentDepartmentId,
          departmentHeadEmployeeId: data.departmentHeadEmployeeId,
          createdById: data.createdById,
        },
      });
      return { department, wasCreated: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        const existing = await this.prisma.department.findFirst({
          where: { organisationId: data.organisationId, code: data.code },
        });
        if (existing) {
          return { department: existing, wasCreated: false };
        }
      }
      throw error;
    }
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.DepartmentUncheckedUpdateInput,
  ): Promise<Department | null> {
    return this.updateMatching(organisationId, id, data);
  }

  activate(organisationId: string, id: string): Promise<Department | null> {
    return this.updateMatching(organisationId, id, { status: DepartmentStatus.ACTIVE });
  }

  deactivate(organisationId: string, id: string): Promise<Department | null> {
    return this.updateMatching(organisationId, id, { status: DepartmentStatus.INACTIVE });
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.DepartmentUncheckedUpdateInput,
  ): Promise<Department | null> {
    const result = await this.prisma.department.updateMany({ where: { id, organisationId }, data });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.department.findUniqueOrThrow({ where: { id } });
  }
}
