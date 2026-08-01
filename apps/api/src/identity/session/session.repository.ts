import { Injectable } from '@nestjs/common';
import { Prisma, RefreshToken, Session } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Thin Prisma access for the Session aggregate (Session, RefreshToken). No login/logout/
 * refresh logic — see SessionService and docs/domains/identity.md §4/§5/§9. Nothing in
 * Sprint 1B.1 calls the write methods here; they exist so the schema-level shape is
 * declared ahead of the (future) authentication layer.
 */
@Injectable()
export class SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.SessionCreateInput): Promise<Session> {
    return this.prisma.session.create({ data });
  }

  findById(organisationId: string, id: string): Promise<Session | null> {
    return this.prisma.session.findFirst({ where: { id, organisationId } });
  }

  findManyByUser(organisationId: string, userId: string): Promise<Session[]> {
    return this.prisma.session.findMany({
      where: { organisationId, userId, revokedAt: null },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  async revoke(organisationId: string, id: string, revokedAt: Date = new Date()): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id, organisationId },
      data: { revokedAt },
    });
  }

  async revokeAllForUser(
    organisationId: string,
    userId: string,
    revokedAt: Date = new Date(),
  ): Promise<void> {
    await this.prisma.session.updateMany({
      where: { organisationId, userId, revokedAt: null },
      data: { revokedAt },
    });
  }

  /** Same as {@link revokeAllForUser}, excluding one session — added Sprint 3.3 for
   *  change-password's "invalidate every other session, keep the current one signed in"
   *  requirement (brief §2), distinct from reset-password's "revoke everything, including
   *  the session that requested the reset" via {@link revokeAllForUser}. */
  async revokeAllForUserExcept(
    organisationId: string,
    userId: string,
    exceptSessionId: string,
    revokedAt: Date = new Date(),
  ): Promise<void> {
    await this.prisma.session.updateMany({
      where: { organisationId, userId, revokedAt: null, id: { not: exceptSessionId } },
      data: { revokedAt },
    });
  }

  updateLastUsedAt(id: string, at: Date = new Date()): Promise<Session> {
    return this.prisma.session.update({ where: { id }, data: { lastUsedAt: at } });
  }

  // --- RefreshToken ---

  createRefreshToken(data: Prisma.RefreshTokenCreateInput): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({ data });
  }

  findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  rotateRefreshToken(
    oldTokenId: string,
    newToken: Prisma.RefreshTokenCreateInput,
  ): Promise<RefreshToken> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({ data: newToken });
      await tx.refreshToken.update({
        where: { id: oldTokenId },
        data: { replacedByTokenId: created.id },
      });
      return created;
    });
  }
}
