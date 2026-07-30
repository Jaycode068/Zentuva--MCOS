import { Injectable } from '@nestjs/common';
import { PasswordResetToken, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Thin Prisma access for the PasswordResetToken entity (identity.md §4/§9). Not built in
 * Sprint 1B.1 ("nothing calls it yet" — see docs/sprint-1B.1-completion-report.md); the
 * Password Reset flow is this sprint's job, so it's added now.
 */
@Injectable()
export class PasswordResetRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.PasswordResetTokenCreateInput): Promise<PasswordResetToken> {
    return this.prisma.passwordResetToken.create({ data });
  }

  findByTokenHash(tokenHash: string): Promise<PasswordResetToken | null> {
    return this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  }

  async markUsed(id: string, usedAt: Date = new Date()): Promise<PasswordResetToken> {
    return this.prisma.passwordResetToken.update({ where: { id }, data: { usedAt } });
  }
}
