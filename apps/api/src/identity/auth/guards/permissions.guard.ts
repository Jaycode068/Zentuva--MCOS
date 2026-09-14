import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { EffectiveAccessResolver } from '../../authorization/effective-access-resolver';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { TokenPayload } from '../ports/token.port';

/**
 * Sprint 25 — Configurable Access Control (docs/domains/access-control.md §9). Must run
 * *after* {@link JwtAuthGuard} — it reads `req.user`, which only JwtAuthGuard sets. Deny
 * by default: no `@RequirePermission(...)` metadata means this guard does nothing (the
 * route is unprotected by it — most routes stay on the older `@Roles`/`RolesGuard`
 * check or no role check at all, per access-control.md §10); a
 * `@RequirePermission(key)` with no matching, active, non-`NONE`-scope grant is always
 * rejected — a missing scope is never interpreted as unrestricted access.
 *
 * Also rejects when the caller's `User` account is not `ACTIVE` (suspended/deactivated/
 * locked/invited) — `EffectiveAccessResolver.resolve()` already returns empty access in
 * that case, so this falls out of the same check without a separate status lookup here.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly effectiveAccessResolver: EffectiveAccessResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.get<string | undefined>(
      REQUIRE_PERMISSION_KEY,
      context.getHandler(),
    );
    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: TokenPayload }>();
    if (!request.user) {
      throw new ForbiddenException('Authentication required');
    }

    const access = await this.effectiveAccessResolver.resolve(
      request.user.organisationId,
      request.user.sub,
    );
    if (!EffectiveAccessResolver.isGranted(access, requiredPermission)) {
      throw new ForbiddenException(`Missing required permission: ${requiredPermission}`);
    }
    return true;
  }
}
