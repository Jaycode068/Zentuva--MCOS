import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  CreateUserInput,
  UpdateUserInput,
  createUserSchema,
  updateUserSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../audit/audit.service';
import { ZodValidationPipe } from '../auth/common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TokenPayload } from '../auth/ports/token.port';
import { USER_AUDIT_ACTIONS } from './user-audit-actions';
import { UserWithRoles } from './user.repository';
import { UserService, toWireStatus } from './user.service';

/**
 * User Management HTTP surface (Sprint 2.2 brief): list/view/create/update users within
 * the caller's own organisation only — no invitation email, self-service onboarding, or
 * permission management (all explicitly deferred). `GET` requires only authentication
 * (Member has read-only access, per the brief); `POST`/`PATCH` additionally require the
 * Owner or Administrator role (RolesGuard, same mechanism as Sprint 2.1).
 *
 * Tenant isolation: every method resolves the target user by `(id, organisationId)`
 * together (never by `id` alone), scoped to the caller's own `organisationId` from their
 * JWT — a user in one organisation can never read, update, or discover the existence of a
 * user in another (a cross-tenant id 404s exactly like a nonexistent one).
 */
@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async list(@CurrentUser() user: TokenPayload) {
    const users = await this.userService.listWithRoles(user.organisationId);
    return { items: users.map(toUserResponse) };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const target = await this.userService.getByIdWithRoles(user.organisationId, id);
    if (!target) {
      throw new NotFoundException('User not found');
    }
    return toUserResponse(target);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const created = await this.userService.createUser(user.organisationId, body);

    await this.auditService.record({
      action: USER_AUDIT_ACTIONS.CREATED,
      entityType: 'User',
      entityId: created.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toUserResponse(created);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.userService.updateUser(user.organisationId, id, body);

    await this.auditService.record({
      action: resolveUpdateAuditAction(body),
      entityType: 'User',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toUserResponse(updated);
  }
}

/** One audit event per `PATCH` call: a status change to `ACTIVE`/`INACTIVE`/`LOCKED` is
 *  recorded as activated/deactivated (the brief's four distinct actions), anything else
 *  (profile fields, role, or a status change to `LOCKED` alongside them) as a generic
 *  update. If a request changes both status and other fields, the status event wins —
 *  simpler than emitting two events per request, and the response still reflects
 *  everything that changed. */
function resolveUpdateAuditAction(body: UpdateUserInput): string {
  if (body.status === 'ACTIVE') return USER_AUDIT_ACTIONS.ACTIVATED;
  if (body.status === 'INACTIVE' || body.status === 'LOCKED') return USER_AUDIT_ACTIONS.DEACTIVATED;
  return USER_AUDIT_ACTIONS.UPDATED;
}

function toUserResponse(user: UserWithRoles) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    employeeCode: user.employeeCode,
    role: user.userRoles[0]?.role.name ?? null,
    status: toWireStatus(user.status),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
