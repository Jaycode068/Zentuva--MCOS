import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceCorrectionRequest } from '@prisma/client';
import {
  RequestAttendanceCorrectionInput,
  ReviewAttendanceCorrectionInput,
} from '@zentuva/validation';

import { AttendanceCorrectionRepository } from './attendance-correction.repository';
import { AttendanceRepository } from './attendance.repository';
import { EmployeeRepository } from './employee.repository';

@Injectable()
export class AttendanceCorrectionService {
  constructor(
    private readonly correctionRepository: AttendanceCorrectionRepository,
    private readonly attendanceRepository: AttendanceRepository,
    private readonly employeeRepository: EmployeeRepository,
  ) {}

  async request(
    organisationId: string,
    attendanceRecordId: string,
    requestedByUserId: string,
    input: RequestAttendanceCorrectionInput,
  ): Promise<AttendanceCorrectionRequest> {
    const record = await this.attendanceRepository.findById(organisationId, attendanceRecordId);
    if (!record) {
      throw new NotFoundException('Attendance record not found');
    }
    if (!input.requestedSignInAt && !input.requestedSignOutAt) {
      throw new BadRequestException(
        'A correction must request a new sign-in time, sign-out time, or both',
      );
    }
    const pending = await this.correctionRepository.findPendingByAttendanceRecord(
      organisationId,
      attendanceRecordId,
    );
    if (pending) {
      throw new BadRequestException(
        'This attendance record already has a pending correction request',
      );
    }

    const requestingEmployee = await this.employeeRepository.findByUserId(
      organisationId,
      requestedByUserId,
    );
    if (!requestingEmployee || requestingEmployee.id !== record.employeeId) {
      throw new BadRequestException(
        'You can only request a correction for your own attendance record',
      );
    }

    return this.correctionRepository.create({
      organisationId,
      attendanceRecordId,
      requestedByEmployeeId: requestingEmployee?.id,
      requestedByUserId,
      requestedSignInAt: input.requestedSignInAt,
      requestedSignOutAt: input.requestedSignOutAt,
      reason: input.reason,
    });
  }

  /** Approval applies atomically: the AttendanceRecord's sign-in/out
   *  columns and this correction's own status change together inside one
   *  transaction (`AttendanceCorrectionRepository.review`). A rejected
   *  decision never touches the attendance record — original values remain
   *  auditable via the attendance record's own history plus this row. */
  async review(
    organisationId: string,
    id: string,
    reviewedByUserId: string,
    input: ReviewAttendanceCorrectionInput,
  ): Promise<AttendanceCorrectionRequest> {
    const correction = await this.correctionRepository.findById(organisationId, id);
    if (!correction) {
      throw new NotFoundException('Correction request not found');
    }
    if (correction.status !== 'REQUESTED') {
      throw new BadRequestException('This correction request has already been reviewed');
    }
    if (correction.requestedByUserId === reviewedByUserId) {
      throw new BadRequestException('You cannot review your own correction request');
    }

    const decisionData = {
      status: input.decision,
      reviewedByUserId,
      reviewedAt: new Date(),
      reviewComment: input.reviewComment,
    };

    const attendanceRecordChanges =
      input.decision === 'APPROVED'
        ? {
            attendanceRecordId: correction.attendanceRecordId,
            changes: {
              ...(correction.requestedSignInAt ? { signInAt: correction.requestedSignInAt } : {}),
              ...(correction.requestedSignOutAt
                ? { signOutAt: correction.requestedSignOutAt }
                : {}),
              reviewStatus: 'APPROVED' as const,
            },
          }
        : null;

    const updated = await this.correctionRepository.review(
      organisationId,
      id,
      decisionData,
      attendanceRecordChanges,
    );
    if (!updated) {
      throw new BadRequestException('This correction request has already been reviewed');
    }
    return updated;
  }

  listForAttendanceRecord(
    organisationId: string,
    attendanceRecordId: string,
  ): Promise<AttendanceCorrectionRequest[]> {
    return this.correctionRepository.findManyByAttendanceRecord(organisationId, attendanceRecordId);
  }
}
