import { Injectable } from '@nestjs/common';
import { AttendanceRecord, AttendanceReviewStatus, AttendanceStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListAttendanceParams {
  page: number;
  pageSize: number;
  employeeId?: string;
  departmentId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  status?: AttendanceStatus;
  reviewStatus?: AttendanceReviewStatus;
}

export interface ListAttendanceResult {
  items: AttendanceRecord[];
  total: number;
}

export interface CreateAttendanceRecordData {
  organisationId: string;
  employeeId: string;
  attendanceDate: Date;
  workScheduleId?: string | null;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/** One row per (organisationId, employeeId, attendanceDate) — see the
 *  schema doc comment. `findOrCreateForDate` is this domain's idempotency
 *  primitive: repeated sign-in calls for the same day never create a
 *  duplicate row, mirroring the `generateEmployeeCode`/P2002-catch
 *  convention used everywhere else in this codebase. */
@Injectable()
export class AttendanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<AttendanceRecord | null> {
    return this.prisma.attendanceRecord.findFirst({ where: { id, organisationId } });
  }

  findByIdWithRelations(organisationId: string, id: string) {
    return this.prisma.attendanceRecord.findFirst({
      where: { id, organisationId },
      include: {
        employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
        corrections: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  findByEmployeeAndDate(
    organisationId: string,
    employeeId: string,
    attendanceDate: Date,
  ): Promise<AttendanceRecord | null> {
    return this.prisma.attendanceRecord.findFirst({
      where: { organisationId, employeeId, attendanceDate },
    });
  }

  findManyByEmployeeInRange(
    organisationId: string,
    employeeId: string,
    dateFrom: Date,
    dateTo: Date,
  ): Promise<AttendanceRecord[]> {
    return this.prisma.attendanceRecord.findMany({
      where: { organisationId, employeeId, attendanceDate: { gte: dateFrom, lte: dateTo } },
      orderBy: { attendanceDate: 'desc' },
    });
  }

  async findManyPaginated(
    organisationId: string,
    params: ListAttendanceParams,
  ): Promise<ListAttendanceResult> {
    const where: Prisma.AttendanceRecordWhereInput = {
      organisationId,
      ...(params.employeeId ? { employeeId: params.employeeId } : {}),
      ...(params.departmentId ? { employee: { departmentId: params.departmentId } } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.reviewStatus ? { reviewStatus: params.reviewStatus } : {}),
      ...(params.dateFrom || params.dateTo
        ? {
            attendanceDate: {
              ...(params.dateFrom ? { gte: params.dateFrom } : {}),
              ...(params.dateTo ? { lte: params.dateTo } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where,
        include: {
          employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
        },
        orderBy: [{ attendanceDate: 'desc' }, { createdAt: 'desc' }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.attendanceRecord.count({ where }),
    ]);

    return { items, total };
  }

  /** Idempotency primitive: returns the existing row for this employee/date
   *  if one exists, otherwise creates it — a P2002 race (two concurrent
   *  sign-in requests) is caught and resolved to the winning row, never a
   *  duplicate. */
  async findOrCreateForDate(
    data: CreateAttendanceRecordData,
  ): Promise<{ attendanceRecord: AttendanceRecord; wasCreated: boolean }> {
    const existing = await this.findByEmployeeAndDate(
      data.organisationId,
      data.employeeId,
      data.attendanceDate,
    );
    if (existing) {
      return { attendanceRecord: existing, wasCreated: false };
    }
    try {
      const attendanceRecord = await this.prisma.attendanceRecord.create({
        data: {
          organisationId: data.organisationId,
          employeeId: data.employeeId,
          attendanceDate: data.attendanceDate,
          workScheduleId: data.workScheduleId,
        },
      });
      return { attendanceRecord, wasCreated: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        const winner = await this.findByEmployeeAndDate(
          data.organisationId,
          data.employeeId,
          data.attendanceDate,
        );
        if (winner) {
          return { attendanceRecord: winner, wasCreated: false };
        }
      }
      throw error;
    }
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.AttendanceRecordUncheckedUpdateInput,
  ): Promise<AttendanceRecord | null> {
    return this.updateMatching(organisationId, id, data);
  }

  /** Lazily flips a past day's dangling sign-in (no sign-out) to
   *  INCOMPLETE — the same no-cron-job derivation strategy training's
   *  OVERDUE status uses. Never touches today's bucket (still in
   *  progress) or an already-reviewed/corrected record. */
  async markPastIncomplete(organisationId: string, todayBucket: Date): Promise<void> {
    await this.prisma.attendanceRecord.updateMany({
      where: {
        organisationId,
        attendanceDate: { lt: todayBucket },
        signInAt: { not: null },
        signOutAt: null,
        status: { in: ['PRESENT', 'LATE'] },
      },
      data: { status: 'INCOMPLETE' },
    });
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.AttendanceRecordUncheckedUpdateInput,
  ): Promise<AttendanceRecord | null> {
    const result = await this.prisma.attendanceRecord.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.attendanceRecord.findUniqueOrThrow({ where: { id } });
  }
}
