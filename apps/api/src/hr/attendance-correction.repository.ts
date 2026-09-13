import { Injectable } from '@nestjs/common';
import { AttendanceCorrectionRequest, AttendanceCorrectionStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface CreateCorrectionData {
  organisationId: string;
  attendanceRecordId: string;
  requestedByEmployeeId?: string;
  requestedByUserId: string;
  requestedSignInAt?: Date;
  requestedSignOutAt?: Date;
  reason: string;
}

@Injectable()
export class AttendanceCorrectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<AttendanceCorrectionRequest | null> {
    return this.prisma.attendanceCorrectionRequest.findFirst({ where: { id, organisationId } });
  }

  findPendingByAttendanceRecord(
    organisationId: string,
    attendanceRecordId: string,
  ): Promise<AttendanceCorrectionRequest | null> {
    return this.prisma.attendanceCorrectionRequest.findFirst({
      where: { organisationId, attendanceRecordId, status: 'REQUESTED' },
    });
  }

  findManyByAttendanceRecord(
    organisationId: string,
    attendanceRecordId: string,
  ): Promise<AttendanceCorrectionRequest[]> {
    return this.prisma.attendanceCorrectionRequest.findMany({
      where: { organisationId, attendanceRecordId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(data: CreateCorrectionData): Promise<AttendanceCorrectionRequest> {
    return this.prisma.attendanceCorrectionRequest.create({
      data: {
        organisationId: data.organisationId,
        attendanceRecordId: data.attendanceRecordId,
        requestedByEmployeeId: data.requestedByEmployeeId,
        requestedByUserId: data.requestedByUserId,
        requestedSignInAt: data.requestedSignInAt,
        requestedSignOutAt: data.requestedSignOutAt,
        reason: data.reason,
      },
    });
  }

  /** Applies an APPROVED decision atomically: the correction row and its
   *  target AttendanceRecord are updated together inside one transaction —
   *  a REJECTED decision never touches the attendance record (only this
   *  method does, gated by `attendanceRecordChanges` being non-null). */
  async review(
    organisationId: string,
    id: string,
    decisionData: Prisma.AttendanceCorrectionRequestUncheckedUpdateInput,
    attendanceRecordChanges: {
      attendanceRecordId: string;
      changes: Prisma.AttendanceRecordUncheckedUpdateInput;
    } | null,
  ): Promise<AttendanceCorrectionRequest | null> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.attendanceCorrectionRequest.updateMany({
        where: { id, organisationId, status: 'REQUESTED' },
        data: decisionData,
      });
      if (result.count === 0) {
        return null;
      }
      if (attendanceRecordChanges) {
        await tx.attendanceRecord.updateMany({
          where: { id: attendanceRecordChanges.attendanceRecordId, organisationId },
          data: attendanceRecordChanges.changes,
        });
      }
      return tx.attendanceCorrectionRequest.findUniqueOrThrow({ where: { id } });
    });
  }
}

export type { AttendanceCorrectionStatus };
