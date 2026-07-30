import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

import { TokenPayload } from '../ports/token.port';

/** Extracts the {@link TokenPayload} attached by {@link JwtAuthGuard}. Only usable on
 *  routes guarded by it. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TokenPayload => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: TokenPayload }>();
    if (!request.user) {
      throw new Error('CurrentUser used on a route without JwtAuthGuard');
    }
    return request.user;
  },
);
