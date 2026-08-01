import { RefreshToken, Session } from '@prisma/client';

/**
 * Session/refresh-token persistence, behind an interface (Sprint 1B.2 brief: "SessionStore
 * abstraction → implemented today with the database"). AuthService never calls
 * SessionRepository/Prisma directly, only this port — swapping to a Redis-backed store
 * later is a new adapter, not a rewrite of AuthService.
 */
export interface CreateSessionParams {
  userId: string;
  organisationId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface IssueRefreshTokenParams {
  sessionId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface SessionStore {
  createSession(params: CreateSessionParams): Promise<Session>;
  issueRefreshToken(params: IssueRefreshTokenParams): Promise<RefreshToken>;
  findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null>;
  /** Rotates `oldTokenId` to a newly-issued token, linking them for reuse detection
   *  (identity.md §5/§9 — `replacedByTokenId`). */
  rotateRefreshToken(oldTokenId: string, next: IssueRefreshTokenParams): Promise<RefreshToken>;
  findSessionById(organisationId: string, sessionId: string): Promise<Session | null>;
  touchSession(sessionId: string): Promise<void>;
  revokeSession(organisationId: string, sessionId: string): Promise<void>;
  revokeAllSessionsForUser(organisationId: string, userId: string): Promise<void>;
  /** Added Sprint 3.3 — change-password revokes every other session but keeps the one
   *  making the request signed in (brief §2). */
  revokeAllSessionsForUserExcept(
    organisationId: string,
    userId: string,
    exceptSessionId: string,
  ): Promise<void>;
  listActiveSessions(organisationId: string, userId: string): Promise<Session[]>;
}

export const SESSION_STORE = Symbol('SESSION_STORE');
