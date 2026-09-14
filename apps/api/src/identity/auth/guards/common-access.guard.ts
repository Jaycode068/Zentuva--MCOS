import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { mergeCommonEmployeeAccessPolicy } from '../../authorization/common-access-policy';
import { OrganisationService } from '../../organisation/organisation.service';
import { REQUIRE_COMMON_ACCESS_KEY } from '../decorators/require-common-access.decorator';
import { TokenPayload } from '../ports/token.port';

/**
 * Sprint 25 — Configurable Access Control (docs/domains/access-control.md §6). Must run
 * after {@link JwtAuthGuard}. No `@RequireCommonAccess(...)` metadata means this guard
 * does nothing. When present, denies the request if the organisation has disabled that
 * specific self-service capability — regardless of the caller's own role/permission
 * grants, since this is an organisation-wide switch, not a per-user one.
 */
@Injectable()
export class CommonAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly organisationService: OrganisationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const capability = this.reflector.get<string | undefined>(
      REQUIRE_COMMON_ACCESS_KEY,
      context.getHandler(),
    );
    if (!capability) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: TokenPayload }>();
    if (!request.user) {
      throw new ForbiddenException('Authentication required');
    }

    const organisation = await this.organisationService.getById(request.user.organisationId);
    const policy = mergeCommonEmployeeAccessPolicy(organisation?.settings);
    const isEnabled = policy[capability as keyof typeof policy];
    if (!isEnabled) {
      throw new ForbiddenException(
        `This organisation has disabled the "${capability}" self-service capability`,
      );
    }
    return true;
  }
}
