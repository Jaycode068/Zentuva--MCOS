import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { OfferStatus } from '@prisma/client';
import {
  CreateOfferInput,
  DeclineOfferInput,
  createOfferSchema,
  declineOfferSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { OfferService } from './offer.service';
import { RECRUITMENT_AUDIT_ACTIONS } from './recruitment-audit-actions';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Offer" / §"Candidate → Employee → Onboarding"). `accept`
 * is where the recruitment lifecycle hands off to the existing HR Employee/
 * Onboarding architecture — see `OfferService.accept()`'s own doc comment
 * for the exact, documented transition point.
 */
@Controller('hr/recruitment/offers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OfferController {
  constructor(
    private readonly offerService: OfferService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermission('hr.recruitment.application.view')
  list(@CurrentUser() user: TokenPayload, @Query('status') status?: OfferStatus) {
    return this.offerService.list(user.organisationId, status);
  }

  @Get(':id')
  @RequirePermission('hr.recruitment.application.view')
  getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.offerService.getById(user.organisationId, id);
  }

  @Post('applications/:applicationId')
  @RequirePermission('hr.recruitment.offer.manage')
  async create(
    @Param('applicationId') applicationId: string,
    @Body(new ZodValidationPipe(createOfferSchema)) body: CreateOfferInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const offer = await this.offerService.create(
      user.organisationId,
      applicationId,
      body,
      user.sub,
    );
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.OFFER_CREATED,
      entityType: 'Offer',
      entityId: offer.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { applicationId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return offer;
  }

  @Post(':id/issue')
  @RequirePermission('hr.recruitment.offer.manage')
  async issue(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const offer = await this.offerService.issue(user.organisationId, id);
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.OFFER_ISSUED,
      entityType: 'Offer',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return offer;
  }

  @Post(':id/accept')
  @RequirePermission('hr.recruitment.offer.manage')
  async accept(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const result = await this.offerService.accept(user.organisationId, id, user.sub);
    if (result.wasNewConversion) {
      await this.auditService.record({
        action: RECRUITMENT_AUDIT_ACTIONS.OFFER_ACCEPTED,
        entityType: 'Offer',
        entityId: id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      await this.auditService.record({
        action: RECRUITMENT_AUDIT_ACTIONS.CANDIDATE_CONVERTED_TO_EMPLOYEE,
        entityType: 'Employee',
        entityId: result.employee.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { offerId: id, employeeCode: result.employee.employeeCode },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return result;
  }

  @Post(':id/decline')
  @RequirePermission('hr.recruitment.offer.manage')
  async decline(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(declineOfferSchema)) body: DeclineOfferInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const offer = await this.offerService.decline(user.organisationId, id, body.notes);
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.OFFER_DECLINED,
      entityType: 'Offer',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return offer;
  }

  @Post(':id/withdraw')
  @RequirePermission('hr.recruitment.offer.manage')
  async withdraw(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const offer = await this.offerService.withdraw(user.organisationId, id);
    await this.auditService.record({
      action: RECRUITMENT_AUDIT_ACTIONS.OFFER_WITHDRAWN,
      entityType: 'Offer',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return offer;
  }
}
