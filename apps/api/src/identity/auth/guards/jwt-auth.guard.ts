import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

import { TOKEN_SERVICE, TokenPayload, TokenService } from '../ports/token.port';

/**
 * Verifies the `Authorization: Bearer <accessToken>` header and attaches the decoded
 * payload to `req.user`. Pure authentication — proves *who* the caller is. Does **not**
 * check roles or permissions (that's RBAC, explicitly out of scope for Sprint 1B.2 — see
 * the brief's "Do not implement authorisation (RBAC)... Do not implement permission
 * guards").
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(TOKEN_SERVICE) private readonly tokenService: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: TokenPayload }>();
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer access token');
    }

    const token = header.slice('Bearer '.length);
    request.user = this.tokenService.verifyAccessToken(token);
    return true;
  }
}
