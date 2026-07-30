import { Injectable } from '@nestjs/common';
import { RefreshToken, Session } from '@prisma/client';

import { SessionRepository } from '../../session/session.repository';
import {
  CreateSessionParams,
  IssueRefreshTokenParams,
  SessionStore,
} from '../ports/session-store.port';

/**
 * Database-backed implementation of {@link SessionStore} (Sprint 1B.2 brief §"SessionStore
 * abstraction → implemented today with the database"), wrapping the existing
 * {@link SessionRepository} from Sprint 1B.1. A future Redis-backed store implements the
 * same interface without AuthService changing at all.
 */
@Injectable()
export class DatabaseSessionStore implements SessionStore {
  constructor(private readonly sessionRepository: SessionRepository) {}

  createSession(params: CreateSessionParams): Promise<Session> {
    return this.sessionRepository.create({
      user: { connect: { id: params.userId } },
      organisation: { connect: { id: params.organisationId } },
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
  }

  issueRefreshToken(params: IssueRefreshTokenParams): Promise<RefreshToken> {
    return this.sessionRepository.createRefreshToken({
      session: { connect: { id: params.sessionId } },
      tokenHash: params.tokenHash,
      expiresAt: params.expiresAt,
    });
  }

  findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.sessionRepository.findRefreshTokenByHash(tokenHash);
  }

  rotateRefreshToken(oldTokenId: string, next: IssueRefreshTokenParams): Promise<RefreshToken> {
    return this.sessionRepository.rotateRefreshToken(oldTokenId, {
      session: { connect: { id: next.sessionId } },
      tokenHash: next.tokenHash,
      expiresAt: next.expiresAt,
    });
  }

  findSessionById(organisationId: string, sessionId: string): Promise<Session | null> {
    return this.sessionRepository.findById(organisationId, sessionId);
  }

  async touchSession(sessionId: string): Promise<void> {
    await this.sessionRepository.updateLastUsedAt(sessionId);
  }

  revokeSession(organisationId: string, sessionId: string): Promise<void> {
    return this.sessionRepository.revoke(organisationId, sessionId);
  }

  revokeAllSessionsForUser(organisationId: string, userId: string): Promise<void> {
    return this.sessionRepository.revokeAllForUser(organisationId, userId);
  }

  listActiveSessions(organisationId: string, userId: string): Promise<Session[]> {
    return this.sessionRepository.findManyByUser(organisationId, userId);
  }
}
