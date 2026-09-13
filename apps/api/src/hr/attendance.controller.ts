import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AttendanceReviewStatus, AttendanceStatus } from '@prisma/client';
import {
  AdministrativeAttendanceInput,
  RequestAttendanceCorrectionInput,
  ReviewAttendanceCorrectionInput,
  ReviewAttendanceInput,
  SignInInput,
  SignOutInput,
  administrativeAttendanceSchema,
  paginationSchema,
  requestAttendanceCorrectionSchema,
  reviewAttendanceCorrectionSchema,
  reviewAttendanceSchema,
  signInSchema,
  signOutSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { Roles } from '../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/auth/guards/roles.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { AttendanceCorrectionService } from './attendance-correction.service';
import { AttendanceService } from './attendance.service';
import { HR_AUDIT_ACTIONS } from './hr-audit-actions';

function parseDateOrDefault(raw: string | undefined, fallback: Date): Date {
  if (!raw) return fallback;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`Invalid date: ${raw}`);
  }
  return parsed;
}

@Controller('hr/attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly correctionService: AttendanceCorrectionService,
    private readonly auditService: AuditService,
  ) {}

  // --- Self-service ---------------------------------------------------------

  @Get('me')
  getMyAttendance(
    @CurrentUser() user: TokenPayload,
    @Query('dateFrom') dateFromRaw?: string,
    @Query('dateTo') dateToRaw?: string,
  ) {
    const now = new Date();
    const dateTo = parseDateOrDefault(dateToRaw, now);
    const dateFrom = parseDateOrDefault(dateFromRaw, new Date(now.getTime() - 30 * 86400000));
    return this.attendanceService.getMyAttendance(user.organisationId, user.sub, dateFrom, dateTo);
  }

  @Post('sign-in')
  async signIn(
    @Body(new ZodValidationPipe(signInSchema)) body: SignInInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { attendanceRecord, transitioned } = await this.attendanceService.signIn(
      user.organisationId,
      user.sub,
      body,
    );
    if (transitioned) {
      await this.auditService.record({
        action: HR_AUDIT_ACTIONS.ATTENDANCE_SIGNED_IN,
        entityType: 'AttendanceRecord',
        entityId: attendanceRecord.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return attendanceRecord;
  }

  @Post('sign-out')
  async signOut(
    @Body(new ZodValidationPipe(signOutSchema)) body: SignOutInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { attendanceRecord, transitioned } = await this.attendanceService.signOut(
      user.organisationId,
      user.sub,
      body,
    );
    if (transitioned) {
      await this.auditService.record({
        action: HR_AUDIT_ACTIONS.ATTENDANCE_SIGNED_OUT,
        entityType: 'AttendanceRecord',
        entityId: attendanceRecord.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return attendanceRecord;
  }

  @Post(':id/corrections')
  async requestCorrection(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(requestAttendanceCorrectionSchema))
    body: RequestAttendanceCorrectionInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const correction = await this.correctionService.request(
      user.organisationId,
      id,
      user.sub,
      body,
    );
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.ATTENDANCE_CORRECTION_REQUESTED,
      entityType: 'AttendanceRecord',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { correctionId: correction.id },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return correction;
  }

  // --- Administration ---------------------------------------------------------

  @Get()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
    @Query('employeeId') employeeId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('dateFrom') dateFromRaw?: string,
    @Query('dateTo') dateToRaw?: string,
    @Query('status') status?: AttendanceStatus,
    @Query('reviewStatus') reviewStatus?: AttendanceReviewStatus,
  ) {
    const { page, pageSize } = paginationSchema.parse({ page: pageRaw, pageSize: pageSizeRaw });
    const result = await this.attendanceService.list(user.organisationId, {
      page,
      pageSize,
      employeeId: employeeId || undefined,
      departmentId: departmentId || undefined,
      dateFrom: dateFromRaw ? parseDateOrDefault(dateFromRaw, new Date()) : undefined,
      dateTo: dateToRaw ? parseDateOrDefault(dateToRaw, new Date()) : undefined,
      status: status || undefined,
      reviewStatus: reviewStatus || undefined,
    });
    return { items: result.items, total: result.total, page, pageSize };
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.attendanceService.getById(user.organisationId, id);
  }

  @Post('administrative')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async administrativeEntry(
    @Body(new ZodValidationPipe(administrativeAttendanceSchema))
    body: AdministrativeAttendanceInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const record = await this.attendanceService.administrativeEntry(user.organisationId, body);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.ATTENDANCE_ADMINISTRATIVE_ENTRY,
      entityType: 'AttendanceRecord',
      entityId: record.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { employeeId: body.employeeId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return record;
  }

  @Post(':id/review')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async review(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewAttendanceSchema)) body: ReviewAttendanceInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.attendanceService.review(user.organisationId, id, body);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.ATTENDANCE_REVIEWED,
      entityType: 'AttendanceRecord',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { reviewStatus: body.reviewStatus },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Get(':id/corrections')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async listCorrections(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const items = await this.correctionService.listForAttendanceRecord(user.organisationId, id);
    return { items };
  }

  @Post('corrections/:id/review')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async reviewCorrection(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewAttendanceCorrectionSchema))
    body: ReviewAttendanceCorrectionInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.correctionService.review(user.organisationId, id, user.sub, body);
    await this.auditService.record({
      action:
        body.decision === 'APPROVED'
          ? HR_AUDIT_ACTIONS.ATTENDANCE_CORRECTION_APPROVED
          : HR_AUDIT_ACTIONS.ATTENDANCE_CORRECTION_REJECTED,
      entityType: 'AttendanceRecord',
      entityId: updated.attendanceRecordId,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { correctionId: updated.id },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }
}
