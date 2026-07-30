/**
 * JWT authentication, behind an interface (Sprint 1B.2 brief §2): AuthService never calls
 * a JWT library directly, only this port. Swapping to opaque tokens or a different signer
 * later is a new adapter, not a rewrite of AuthService.
 *
 * Both access and refresh tokens are JWTs (per this sprint's brief — separate secrets,
 * separate expiries), but the refresh token is still stored **hashed** and rotated with
 * reuse detection, per docs/domains/identity.md §5/§9 — see
 * docs/sprint-1B.2-completion-report.md for how these two requirements were reconciled.
 */
export interface TokenPayload {
  /** User id. */
  sub: string;
  organisationId: string;
  sessionId: string;
}

export interface TokenService {
  signAccessToken(payload: TokenPayload): string;
  verifyAccessToken(token: string): TokenPayload;
  signRefreshToken(payload: TokenPayload): string;
  verifyRefreshToken(token: string): TokenPayload;
  getAccessTokenExpirySeconds(): number;
  getRefreshTokenExpiryMs(): number;
}

export const TOKEN_SERVICE = Symbol('TOKEN_SERVICE');
