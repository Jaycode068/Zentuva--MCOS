import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { TokenPayload, TokenService } from '../ports/token.port';

/**
 * JWT implementation of {@link TokenService} (Sprint 1B.2 brief §2), using `@nestjs/jwt`.
 * Access and refresh tokens use separate secrets and expiries, both env-configured —
 * validated at boot to be non-empty and different (apps/api/src/config/env.validation.ts).
 */
@Injectable()
export class JwtTokenService implements TokenService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessExpiresIn: string;
  private readonly refreshExpiresIn: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.accessSecret = config.getOrThrow<string>('auth.jwtAccessSecret');
    this.refreshSecret = config.getOrThrow<string>('auth.jwtRefreshSecret');
    this.accessExpiresIn = config.get<string>('auth.jwtAccessExpiresIn', '15m');
    this.refreshExpiresIn = config.get<string>('auth.jwtRefreshExpiresIn', '30d');
  }

  signAccessToken(payload: TokenPayload): string {
    return this.jwt.sign(payload, { secret: this.accessSecret, expiresIn: this.accessExpiresIn });
  }

  verifyAccessToken(token: string): TokenPayload {
    return this.verify(token, this.accessSecret);
  }

  signRefreshToken(payload: TokenPayload): string {
    return this.jwt.sign(payload, {
      secret: this.refreshSecret,
      expiresIn: this.refreshExpiresIn,
    });
  }

  verifyRefreshToken(token: string): TokenPayload {
    return this.verify(token, this.refreshSecret);
  }

  getAccessTokenExpirySeconds(): number {
    return parseDurationToSeconds(this.accessExpiresIn);
  }

  getRefreshTokenExpiryMs(): number {
    return parseDurationToSeconds(this.refreshExpiresIn) * 1000;
  }

  private verify(token: string, secret: string): TokenPayload {
    try {
      return this.jwt.verify<TokenPayload>(token, { secret });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

/**
 * Parses a small, explicit set of duration units (`s`/`m`/`h`/`d`) into seconds — just
 * enough to turn `JWT_ACCESS_EXPIRES_IN`/`JWT_REFRESH_EXPIRES_IN` into a numeric
 * `expiresIn` for API responses, without adding a dependency for it.
 */
export function parseDurationToSeconds(duration: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(duration.trim());
  if (!match) {
    throw new Error(
      `Invalid duration "${duration}" — expected a number followed by s/m/h/d (e.g. "15m").`,
    );
  }
  const value = Number(match[1]);
  const unitSeconds = { s: 1, m: 60, h: 3600, d: 86400 } as const;
  return value * unitSeconds[match[2] as 's' | 'm' | 'h' | 'd'];
}
