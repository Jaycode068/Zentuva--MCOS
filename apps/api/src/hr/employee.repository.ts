import { Injectable } from '@nestjs/common';
import { Employee, EmploymentStatus, EmploymentType, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { generateEmployeeCode } from './employee-code';

export interface ListEmployeesParams {
  page: number;
  pageSize: number;
  search?: string;
  departmentId?: string;
  positionId?: string;
  employmentType?: EmploymentType;
  employmentStatus?: EmploymentStatus;
  unlinkedOnly?: boolean;
}

export interface ListEmployeesResult {
  items: Employee[];
  total: number;
}

export interface CreateEmployeeData {
  organisationId: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  preferredName?: string;
  workEmail?: string;
  personalEmail?: string;
  phoneNumber?: string;
  alternatePhoneNumber?: string;
  dateOfBirth?: Date;
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | 'PREFER_NOT_TO_SAY';
  nationality?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelationship?: string;
  departmentId?: string;
  positionId?: string;
  managerEmployeeId?: string;
  employmentType: EmploymentType;
  hireDate: Date;
  probationEndDate?: Date;
  notes?: string;
  createdById: string;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class EmployeeRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<Employee | null> {
    return this.prisma.employee.findFirst({ where: { id, organisationId } });
  }

  findByIdWithRelations(organisationId: string, id: string) {
    return this.prisma.employee.findFirst({
      where: { id, organisationId },
      include: {
        department: true,
        position: true,
        manager: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
        user: { select: { id: true, email: true, status: true } },
        _count: { select: { directReports: true } },
      },
    });
  }

  findByUserId(organisationId: string, userId: string): Promise<Employee | null> {
    return this.prisma.employee.findFirst({ where: { organisationId, userId } });
  }

  /** Lightweight projection for the Organisation Structure view — never a
   *  graph-engine, just enough fields to render a tree/list client-side. */
  findManyLite(organisationId: string) {
    return this.prisma.employee.findMany({
      where: { organisationId },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        employmentStatus: true,
        departmentId: true,
        positionId: true,
        managerEmployeeId: true,
      },
      orderBy: { employeeCode: 'asc' },
    });
  }

  async getManagerId(id: string): Promise<string | null> {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      select: { managerEmployeeId: true },
    });
    return employee?.managerEmployeeId ?? null;
  }

  private buildWhere(
    organisationId: string,
    params: Partial<ListEmployeesParams>,
  ): Prisma.EmployeeWhereInput {
    return {
      organisationId,
      ...(params.departmentId ? { departmentId: params.departmentId } : {}),
      ...(params.positionId ? { positionId: params.positionId } : {}),
      ...(params.employmentType ? { employmentType: params.employmentType } : {}),
      ...(params.employmentStatus ? { employmentStatus: params.employmentStatus } : {}),
      ...(params.unlinkedOnly ? { userId: null } : {}),
      ...(params.search
        ? {
            OR: [
              { employeeCode: { contains: params.search, mode: 'insensitive' } },
              { firstName: { contains: params.search, mode: 'insensitive' } },
              { lastName: { contains: params.search, mode: 'insensitive' } },
              { workEmail: { contains: params.search, mode: 'insensitive' } },
              { personalEmail: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  count(organisationId: string, params: Partial<ListEmployeesParams> = {}): Promise<number> {
    return this.prisma.employee.count({ where: this.buildWhere(organisationId, params) });
  }

  async findManyPaginated(
    organisationId: string,
    params: ListEmployeesParams,
  ): Promise<ListEmployeesResult> {
    const where = this.buildWhere(organisationId, params);

    const [items, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        include: {
          department: { select: { id: true, name: true } },
          position: { select: { id: true, title: true } },
          manager: { select: { id: true, firstName: true, lastName: true } },
          user: { select: { id: true } },
        },
        orderBy: { employeeCode: 'asc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return { items, total };
  }

  async create(data: CreateEmployeeData): Promise<Employee> {
    return this.prisma.$transaction(async (tx) => {
      const employeeCode = await generateEmployeeCode(tx, data.organisationId);
      return tx.employee.create({
        data: {
          organisationId: data.organisationId,
          employeeCode,
          firstName: data.firstName,
          middleName: data.middleName,
          lastName: data.lastName,
          preferredName: data.preferredName,
          workEmail: data.workEmail,
          personalEmail: data.personalEmail,
          phoneNumber: data.phoneNumber,
          alternatePhoneNumber: data.alternatePhoneNumber,
          dateOfBirth: data.dateOfBirth,
          gender: data.gender,
          nationality: data.nationality,
          address: data.address,
          emergencyContactName: data.emergencyContactName,
          emergencyContactPhone: data.emergencyContactPhone,
          emergencyContactRelationship: data.emergencyContactRelationship,
          departmentId: data.departmentId,
          positionId: data.positionId,
          managerEmployeeId: data.managerEmployeeId,
          employmentType: data.employmentType,
          employmentStatus: 'DRAFT',
          hireDate: data.hireDate,
          probationEndDate: data.probationEndDate,
          notes: data.notes,
          createdById: data.createdById,
        },
      });
    });
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.EmployeeUncheckedUpdateInput,
  ): Promise<Employee | null> {
    return this.updateMatching(organisationId, id, data);
  }

  assignDepartment(
    organisationId: string,
    id: string,
    departmentId: string | null,
  ): Promise<Employee | null> {
    return this.updateMatching(organisationId, id, { departmentId });
  }

  assignPosition(
    organisationId: string,
    id: string,
    positionId: string | null,
  ): Promise<Employee | null> {
    return this.updateMatching(organisationId, id, { positionId });
  }

  assignManager(
    organisationId: string,
    id: string,
    managerEmployeeId: string | null,
  ): Promise<Employee | null> {
    return this.updateMatching(organisationId, id, { managerEmployeeId });
  }

  assignWorkSchedule(
    organisationId: string,
    id: string,
    workScheduleId: string | null,
  ): Promise<Employee | null> {
    return this.updateMatching(organisationId, id, { workScheduleId });
  }

  async linkUser(
    organisationId: string,
    id: string,
    userId: string,
  ): Promise<{ employee: Employee | null; conflict: boolean }> {
    try {
      const employee = await this.updateMatching(organisationId, id, { userId });
      return { employee, conflict: false };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        return { employee: null, conflict: true };
      }
      throw error;
    }
  }

  unlinkUser(organisationId: string, id: string): Promise<Employee | null> {
    return this.updateMatching(organisationId, id, { userId: null });
  }

  setEmploymentStatus(
    organisationId: string,
    id: string,
    data: Prisma.EmployeeUncheckedUpdateInput,
  ): Promise<Employee | null> {
    return this.updateMatching(organisationId, id, data);
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.EmployeeUncheckedUpdateInput,
  ): Promise<Employee | null> {
    const result = await this.prisma.employee.updateMany({ where: { id, organisationId }, data });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.employee.findUniqueOrThrow({ where: { id } });
  }
}
