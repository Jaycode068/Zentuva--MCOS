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
  /** Sprint 25 (docs/domains/access-control.md §8) — real, server-enforced `OWN_TEAM`
   *  scope: restricts the list to this manager's direct reports. Set by
   *  `EmployeeController.list()` when the caller's effective `hr.employee.view` grant
   *  is scoped to `OWN_TEAM` rather than `ORGANISATION`/`DEPARTMENT`, using the
   *  already-existing `managerEmployeeId` relationship — no new data, no new model. */
  managerEmployeeId?: string;
}

export interface ListEmployeesResult {
  /** `user` reflects the actual `findManyPaginated` query's `include` (Sprint 25.1 —
   *  `SalesOrderController`'s `OWN_TEAM` scope needs a direct report's linked
   *  `User.id`; the query always selected it, this interface just hadn't declared it). */
  items: (Employee & { user: { id: string } | null })[];
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
        territory: { select: { id: true, name: true } },
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
      ...(params.managerEmployeeId ? { managerEmployeeId: params.managerEmployeeId } : {}),
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

  /** Added Sprint 45 (docs/domains/reporting.md "Workforce Summary") — one `groupBy`
   *  for the Workforce Summary Report's headcount-by-status breakdown, rather than
   *  one `count()` call per `EmploymentStatus` value. */
  async countGroupedByStatus(
    organisationId: string,
  ): Promise<{ employmentStatus: EmploymentStatus; count: number }[]> {
    const rows = await this.prisma.employee.groupBy({
      by: ['employmentStatus'],
      where: { organisationId },
      _count: true,
    });
    return rows.map((row) => ({ employmentStatus: row.employmentStatus, count: row._count }));
  }

  /** Added Sprint 45 — headcount-by-department for currently-`ACTIVE` employees only
   *  (a separated/draft employee's old department assignment is not "current
   *  headcount"). `departmentId: null` is a real, expected group — an employee with no
   *  department assignment — surfaced as-is; the caller renders it as "Unassigned"
   *  rather than this method silently dropping or miscounting those rows. */
  async countActiveGroupedByDepartment(
    organisationId: string,
  ): Promise<{ departmentId: string | null; count: number }[]> {
    const rows = await this.prisma.employee.groupBy({
      by: ['departmentId'],
      where: { organisationId, employmentStatus: 'ACTIVE' },
      _count: true,
    });
    return rows.map((row) => ({ departmentId: row.departmentId, count: row._count }));
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
          territory: { select: { id: true, name: true } },
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

  /** Sprint 38 — existence of `territoryId` is checked with a direct, read-only Prisma
   *  query against `territory` (scoped by `organisationId`, closing the tenant-isolation
   *  gap a bare foreign-key constraint alone would leave open — the FK only proves the
   *  row exists SOMEWHERE, not that it belongs to this tenant), never a
   *  `TerritoryRepository`/Retail-module import. `HrModule` deliberately imports no
   *  other domain's module (`hr.module.ts`'s own doc comment,
   *  `hr-independence.spec.ts`'s structural guard) — a plain cross-table READ through
   *  the already-injected, globally-shared `PrismaService` is not a module import and
   *  does not cross that boundary, the same narrow-exception reasoning already
   *  documented extensively elsewhere in this codebase (e.g.
   *  `SalesFulfilmentRepository` writing directly to `inventoryStock`). */
  async assignTerritory(
    organisationId: string,
    id: string,
    territoryId: string | null,
  ): Promise<{ employee: Employee | null; invalidTerritory: boolean }> {
    if (territoryId) {
      const territory = await this.prisma.territory.findFirst({
        where: { id: territoryId, organisationId },
        select: { id: true },
      });
      if (!territory) {
        return { employee: null, invalidTerritory: true };
      }
    }
    const employee = await this.updateMatching(organisationId, id, { territoryId });
    return { employee, invalidTerritory: false };
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
