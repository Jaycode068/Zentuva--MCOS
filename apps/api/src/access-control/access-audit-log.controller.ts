import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { RequirePermission } from '../identity/auth/decorators/require-permission.decorator';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { AuditService } from '../identity/audit/audit.service';
import { UserService } from '../identity/user/user.service';

/**
 * Read-only access to the organisation's full audit trail (docs/domains/access-control.md
 * §11 "Access Review" tab) — a thin wrapper over the pre-existing, insert-only
 * `AuditService`/`AuditRepository` (Identity domain), shared by every domain, not just
 * Access Control. Every access-control mutation (role CRUD, permission grant/revoke,
 * role assign/remove, common-policy change) already calls `AuditService.record(...)`;
 * this endpoint is what finally makes the `identity.audit-logs.read` permission
 * (already in the catalogue and granted to Administrator) do something — previously
 * nothing served it. `action`/`entityType` query params allow narrowing to just
 * `access.*` events when needed.
 */
@Controller('access/audit-log')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AccessAuditLogController {
  constructor(
    private readonly auditService: AuditService,
    private readonly userService: UserService,
  ) {}

  @Get()
  @RequirePermission('identity.audit-logs.read')
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const params = {
      action,
      entityType,
      skip: skip ? Number(skip) : undefined,
      take: take ? Math.min(Number(take), 200) : 50,
    };
    const [items, total, users] = await Promise.all([
      this.auditService.listByOrganisation(user.organisationId, params),
      this.auditService.countByOrganisation(user.organisationId),
      this.userService.listByOrganisation(user.organisationId),
    ]);
    const emailById = new Map(users.map((u) => [u.id, u.email]));
    return {
      items: items.map((entry) => ({
        ...entry,
        actorEmail: entry.actorUserId ? (emailById.get(entry.actorUserId) ?? null) : null,
      })),
      total,
    };
  }
}
