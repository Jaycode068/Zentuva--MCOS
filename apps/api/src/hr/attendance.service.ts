import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceRecord } from '@prisma/client';
import {
  AdministrativeAttendanceInput,
  ReviewAttendanceInput,
  SignInInput,
  SignOutInput,
} from '@zentuva/validation';

import { OrganisationService } from '../identity/organisation/organisation.service';
import {
  AttendanceRepository,
  ListAttendanceParams,
  ListAttendanceResult,
} from './attendance.repository';
import { EmployeeRepository } from './employee.repository';
import { isFutureAttendanceDate, resolveAttendanceDate } from './hr-attendance-date.util';
import { WorkScheduleRepository } from './work-schedule.repository';

const DEFAULT_TIME_ZONE = 'UTC';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly attendanceRepository: AttendanceRepository,
    private readonly employeeRepository: EmployeeRepository,
    private readonly workScheduleRepository: WorkScheduleRepository,
    private readonly organisationService: OrganisationService,
  ) {}

  async getById(organisationId: string, id: string) {
    await this.syncPastIncomplete(organisationId);
    return this.getByIdOrThrowWithRelations(organisationId, id);
  }

  async list(organisationId: string, params: ListAttendanceParams): Promise<ListAttendanceResult> {
    await this.syncPastIncomplete(organisationId);
    return this.attendanceRepository.findManyPaginated(organisationId, params);
  }

  /** Admin/employee-detail read: attendance for a known employee id
   *  (no ownership check — callers are expected to be viewing an employee
   *  detail page, the same open-read convention `EmployeeController`
   *  already uses for documents/onboarding/audit). */
  async listForEmployee(organisationId: string, employeeId: string, dateFrom: Date, dateTo: Date) {
    await this.syncPastIncomplete(organisationId);
    return this.attendanceRepository.findManyByEmployeeInRange(
      organisationId,
      employeeId,
      dateFrom,
      dateTo,
    );
  }

  private async syncPastIncomplete(organisationId: string): Promise<void> {
    const timeZone = await this.resolveOrganisationTimeZone(organisationId);
    const todayBucket = resolveAttendanceDate(new Date(), timeZone);
    await this.attendanceRepository.markPastIncomplete(organisationId, todayBucket);
  }

  async getMyAttendance(organisationId: string, userId: string, dateFrom: Date, dateTo: Date) {
    const employee = await this.employeeRepository.findByUserId(organisationId, userId);
    if (!employee) {
      throw new BadRequestException('No employee record is linked to this user account');
    }
    await this.syncPastIncomplete(organisationId);
    const items = await this.attendanceRepository.findManyByEmployeeInRange(
      organisationId,
      employee.id,
      dateFrom,
      dateTo,
    );
    return { employeeId: employee.id, items };
  }

  /** Self-service sign-in — server clock and server-derived date are
   *  authoritative throughout; the caller never supplies a timestamp.
   *  Idempotent: a repeated call for the same organisation-local day
   *  returns the existing record unchanged (`transitioned: false`). */
  async signIn(
    organisationId: string,
    userId: string,
    input: SignInInput,
  ): Promise<{ attendanceRecord: AttendanceRecord; transitioned: boolean }> {
    const employee = await this.employeeRepository.findByUserId(organisationId, userId);
    if (!employee) {
      throw new BadRequestException('No employee record is linked to this user account');
    }
    this.assertCanSelfSign(employee.employmentStatus);

    const timeZone = await this.resolveOrganisationTimeZone(organisationId);
    const now = new Date();
    const attendanceDate = resolveAttendanceDate(now, timeZone);

    const { attendanceRecord } = await this.attendanceRepository.findOrCreateForDate({
      organisationId,
      employeeId: employee.id,
      attendanceDate,
      workScheduleId: employee.workScheduleId,
    });

    if (attendanceRecord.signInAt) {
      return { attendanceRecord, transitioned: false };
    }

    const status = await this.deriveSignInStatus(
      organisationId,
      employee.workScheduleId,
      now,
      timeZone,
    );

    const updated = await this.attendanceRepository.update(organisationId, attendanceRecord.id, {
      signInAt: now,
      signInLatitude: input.location?.latitude,
      signInLongitude: input.location?.longitude,
      signInAccuracyMeters: input.location?.accuracyMeters,
      signInLocationLabel: input.location?.locationLabel,
      status,
      source: 'SELF_SERVICE',
    });
    if (!updated) {
      throw new NotFoundException('Attendance record not found');
    }
    return { attendanceRecord: updated, transitioned: true };
  }

  /** Self-service sign-out. Rejects if there is no sign-in yet for today;
   *  idempotent if already signed out. */
  async signOut(
    organisationId: string,
    userId: string,
    input: SignOutInput,
  ): Promise<{ attendanceRecord: AttendanceRecord; transitioned: boolean }> {
    const employee = await this.employeeRepository.findByUserId(organisationId, userId);
    if (!employee) {
      throw new BadRequestException('No employee record is linked to this user account');
    }
    this.assertCanSelfSign(employee.employmentStatus);

    const timeZone = await this.resolveOrganisationTimeZone(organisationId);
    const now = new Date();
    const attendanceDate = resolveAttendanceDate(now, timeZone);

    const record = await this.attendanceRepository.findByEmployeeAndDate(
      organisationId,
      employee.id,
      attendanceDate,
    );
    if (!record || !record.signInAt) {
      throw new BadRequestException('Cannot sign out before signing in');
    }
    if (record.signOutAt) {
      return { attendanceRecord: record, transitioned: false };
    }

    const updated = await this.attendanceRepository.update(organisationId, record.id, {
      signOutAt: now,
      signOutLatitude: input.location?.latitude,
      signOutLongitude: input.location?.longitude,
      signOutAccuracyMeters: input.location?.accuracyMeters,
      signOutLocationLabel: input.location?.locationLabel,
    });
    if (!updated) {
      throw new NotFoundException('Attendance record not found');
    }
    return { attendanceRecord: updated, transitioned: true };
  }

  /** Administrative entry — an Owner/Administrator records attendance on
   *  behalf of any employee in the organisation. No client-supplied
   *  timestamp here either: the server clock still applies, only the
   *  *date* and the sign-in/sign-out intent are provided. Location is
   *  never captured administratively (no fabricated location data). */
  async administrativeEntry(
    organisationId: string,
    input: AdministrativeAttendanceInput,
  ): Promise<AttendanceRecord> {
    const employee = await this.employeeRepository.findById(organisationId, input.employeeId);
    if (!employee) {
      throw new BadRequestException('Employee not found in this organisation');
    }

    const timeZone = await this.resolveOrganisationTimeZone(organisationId);
    const attendanceDate = resolveAttendanceDate(input.attendanceDate, timeZone);
    if (isFutureAttendanceDate(attendanceDate, new Date(), timeZone)) {
      throw new BadRequestException('Cannot record attendance for a future date');
    }

    const { attendanceRecord } = await this.attendanceRepository.findOrCreateForDate({
      organisationId,
      employeeId: employee.id,
      attendanceDate,
      workScheduleId: employee.workScheduleId,
    });

    const now = new Date();
    const changes: Record<string, unknown> = { source: 'ADMINISTRATIVE' };
    if (input.notes !== undefined) {
      changes.notes = input.notes;
    }
    if (input.signIn && !attendanceRecord.signInAt) {
      changes.signInAt = now;
      changes.status = await this.deriveSignInStatus(
        organisationId,
        employee.workScheduleId,
        now,
        timeZone,
      );
    }
    if (input.signOut && !attendanceRecord.signOutAt) {
      if (!attendanceRecord.signInAt && !input.signIn) {
        throw new BadRequestException('Cannot record a sign-out before a sign-in exists');
      }
      changes.signOutAt = now;
    }

    const updated = await this.attendanceRepository.update(
      organisationId,
      attendanceRecord.id,
      changes,
    );
    if (!updated) {
      throw new NotFoundException('Attendance record not found');
    }
    return updated;
  }

  async review(
    organisationId: string,
    id: string,
    input: ReviewAttendanceInput,
  ): Promise<AttendanceRecord> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.attendanceRepository.update(organisationId, id, {
      reviewStatus: input.reviewStatus,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    });
    if (!updated) {
      throw new NotFoundException('Attendance record not found');
    }
    return updated;
  }

  private assertCanSelfSign(employmentStatus: string): void {
    if (employmentStatus === 'SEPARATED') {
      throw new BadRequestException('A separated employee cannot record attendance');
    }
    if (employmentStatus !== 'ACTIVE') {
      throw new BadRequestException('Only an active employee can self-record attendance');
    }
  }

  private async deriveSignInStatus(
    organisationId: string,
    workScheduleId: string | null,
    signInAt: Date,
    timeZone: string,
  ): Promise<'PRESENT' | 'LATE'> {
    if (!workScheduleId) {
      return 'PRESENT';
    }
    const schedule = await this.workScheduleRepository.findById(organisationId, workScheduleId);
    if (!schedule) {
      return 'PRESENT';
    }
    const localMinutes = this.minutesSinceMidnightInTimeZone(signInAt, timeZone);
    const expectedMinutes =
      this.parseTimeToMinutes(schedule.expectedStartTime) + schedule.gracePeriodMinutes;
    return localMinutes > expectedMinutes ? 'LATE' : 'PRESENT';
  }

  private minutesSinceMidnightInTimeZone(instant: Date, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
    return hour * 60 + minute;
  }

  private parseTimeToMinutes(hhmm: string): number {
    const [hourPart, minutePart] = hhmm.split(':');
    return Number(hourPart) * 60 + Number(minutePart);
  }

  private async resolveOrganisationTimeZone(organisationId: string): Promise<string> {
    const organisation = await this.organisationService.getById(organisationId);
    return organisation?.timeZone ?? DEFAULT_TIME_ZONE;
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<AttendanceRecord> {
    const record = await this.attendanceRepository.findById(organisationId, id);
    if (!record) {
      throw new NotFoundException('Attendance record not found');
    }
    return record;
  }

  private async getByIdOrThrowWithRelations(organisationId: string, id: string) {
    const record = await this.attendanceRepository.findByIdWithRelations(organisationId, id);
    if (!record) {
      throw new NotFoundException('Attendance record not found');
    }
    return record;
  }
}
