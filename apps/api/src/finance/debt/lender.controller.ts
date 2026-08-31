import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Lender, LenderStatus } from '@prisma/client';
import {
  CreateLenderInput,
  UpdateLenderInput,
  createLenderSchema,
  updateLenderSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { DEBT_AUDIT_ACTIONS } from '../debt-audit-actions';
import { LenderService } from './lender.service';

/** Lender HTTP surface (Sprint 17, docs/domains/debt-management.md §7). `GET`
 *  requires only authentication; every write additionally requires the
 *  Owner or Administrator role. */
@Controller('finance/debt/lenders')
@UseGuards(JwtAuthGuard)
export class LenderController {
  constructor(
    private readonly lenderService: LenderService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: TokenPayload, @Query('status') status?: LenderStatus) {
    const items = await this.lenderService.list(user.organisationId, { status });
    return { items: items.map(toLenderResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const lender = await this.lenderService.getById(user.organisationId, id);
    return toLenderResponse(lender);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createLenderSchema)) body: CreateLenderInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { lender, wasCreated } = await this.lenderService.create(
      user.organisationId,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: DEBT_AUDIT_ACTIONS.LENDER_CREATED,
        entityType: 'Lender',
        entityId: lender.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { name: lender.name, type: lender.type },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toLenderResponse(lender);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateLenderSchema)) body: UpdateLenderInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.lenderService.update(user.organisationId, id, body);
    await this.auditService.record({
      action: DEBT_AUDIT_ACTIONS.LENDER_UPDATED,
      entityType: 'Lender',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return toLenderResponse(updated);
  }
}

export function toLenderResponse(lender: Lender) {
  return {
    id: lender.id,
    name: lender.name,
    type: lender.type,
    contactName: lender.contactName,
    email: lender.email,
    phone: lender.phone,
    notes: lender.notes,
    status: lender.status,
    createdAt: lender.createdAt,
    updatedAt: lender.updatedAt,
  };
}
