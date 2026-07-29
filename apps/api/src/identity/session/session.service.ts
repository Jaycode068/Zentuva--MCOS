import { Injectable } from '@nestjs/common';
import { Session } from '@prisma/client';

import { notImplemented } from '../common/not-implemented';
import { SessionRepository } from './session.repository';

/**
 * Domain service for the Session aggregate (Session, RefreshToken).
 *
 * Sprint 1B.1 scope note: listing a user's own sessions is a pure read, implemented for
 * real. Every write here (create/revoke/rotate) *is* login/logout/refresh-token
 * mechanics — explicitly out of scope this sprint (see docs/domains/identity.md §5) — so
 * every write method is a stub, unlike the other services where only auth-adjacent
 * writes are stubbed.
 */
@Injectable()
export class SessionService {
  constructor(private readonly sessionRepository: SessionRepository) {}

  listActiveByUser(organisationId: string, userId: string): Promise<Session[]> {
    return this.sessionRepository.findManyByUser(organisationId, userId);
  }

  getById(organisationId: string, id: string): Promise<Session | null> {
    return this.sessionRepository.findById(organisationId, id);
  }

  /** Issues a new Session + first RefreshToken on successful login or invitation
   *  acceptance (identity.md §5). Deferred. */
  create(_input: CreateSessionInput): Promise<never> {
    return notImplemented('SessionService.create');
  }

  /** Revokes a single session (identity.md §5 Logout Flow). Deferred. */
  revoke(_organisationId: string, _id: string): Promise<never> {
    return notImplemented('SessionService.revoke');
  }

  /** Revokes every session for a user (password reset, "log out everywhere").
   *  Deferred. */
  revokeAllForUser(_organisationId: string, _userId: string): Promise<never> {
    return notImplemented('SessionService.revokeAllForUser');
  }

  /** Exchanges a refresh token for a new access+refresh pair, with reuse detection
   *  (identity.md §5 Refresh Token Flow). Deferred. */
  rotateRefreshToken(_rawRefreshToken: string): Promise<never> {
    return notImplemented('SessionService.rotateRefreshToken');
  }
}

export interface CreateSessionInput {
  userId: string;
  organisationId: string;
  userAgent?: string;
  ipAddress?: string;
}
