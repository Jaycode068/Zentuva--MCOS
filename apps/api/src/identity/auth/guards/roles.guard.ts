import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { RoleService } from '../../role/role.service';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { TokenPayload } from '../ports/token.port';

/**
 * Minimal role-name authorization check (Sprint 2.1 brief §"Authorisation (MVP)"). Must
 * run *after* {@link JwtAuthGuard} — it reads `req.user`, which only JwtAuthGuard sets.
 *
 * Looks up the caller's role names directly (RoleService.getRoleNamesForUser) and checks
 * membership against the route's `@Roles(...)` list. Deliberately not a permission-key
 * evaluation engine (no Permission/RolePermission lookup, no Owner-bypass special-casing
 * beyond Owner simply being one of the declared role names) — that generalized system is
 * out of scope for this sprint, see identity.md §6 and docs/sprint-2.1-completion-report.md.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly roleService: RoleService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.get<string[] | undefined>(ROLES_KEY, context.getHandler());
    if (!requiredRoles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: TokenPayload }>();
    if (!request.user) {
      throw new ForbiddenException('Authentication required');
    }

    const roleNames = await this.roleService.getRoleNamesForUser(
      request.user.organisationId,
      request.user.sub,
    );
    const isAuthorized = roleNames.some((name) => requiredRoles.includes(name));
    if (!isAuthorized) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    return true;
  }
}
