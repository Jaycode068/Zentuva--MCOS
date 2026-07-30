import { Injectable } from '@nestjs/common';
import { Session } from '@prisma/client';

import { notImplemented } from '../common/not-implemented';
import { SessionRepository } from './session.repository';

/**
 * Domain service for the Session aggregate (Session, RefreshToken).
 *
 * Sprint 1B.2 note: `revoke`/`revokeAllForUser` are pure session-revocation (no token
 * material involved) and are now implemented for real. `create`/`rotateRefreshToken`
 * inherently involve generating/hashing token material, which is deliberately kept in the
 * auth layer's `SessionStore` port (`DatabaseSessionStore`), not the general domain
 * service — see docs/sprint-1B.2-completion-report.md "Security decisions". AuthService
 * depends on `SessionStore`, not this service, for those operations.
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

  async revoke(organisationId: string, id: string): Promise<void> {
    await this.sessionRepository.revoke(organisationId, id);
  }

  async revokeAllForUser(organisationId: string, userId: string): Promise<void> {
    await this.sessionRepository.revokeAllForUser(organisationId, userId);
  }

  /** Issuing a session + first refresh token is auth-layer token-material generation —
   *  see AuthService / SessionStore (Sprint 1B.2). */
  create(_input: CreateSessionInput): Promise<never> {
    return notImplemented('SessionService.create — use SessionStore (auth layer) instead');
  }

  /** Rotating a refresh token is auth-layer token-material generation — see AuthService /
   *  SessionStore (Sprint 1B.2). */
  rotateRefreshToken(_rawRefreshToken: string): Promise<never> {
    return notImplemented(
      'SessionService.rotateRefreshToken — use SessionStore (auth layer) instead',
    );
  }
}

export interface CreateSessionInput {
  userId: string;
  organisationId: string;
  userAgent?: string;
  ipAddress?: string;
}
