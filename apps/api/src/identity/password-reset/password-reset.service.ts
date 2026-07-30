import { Injectable } from '@nestjs/common';
import { PasswordResetToken } from '@prisma/client';

import { PasswordResetRepository } from './password-reset.repository';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Domain service for the PasswordResetToken entity. Only manages the token's lifecycle
 * (create/find/mark-used) — it deliberately does not hash passwords or touch User rows;
 * that orchestration (verify token, hash new password, revoke sessions) belongs to
 * AuthService, per docs/sprint-1B.2-completion-report.md "Security decisions".
 */
@Injectable()
export class PasswordResetService {
  constructor(private readonly passwordResetRepository: PasswordResetRepository) {}

  createToken(userId: string, tokenHash: string): Promise<PasswordResetToken> {
    return this.passwordResetRepository.create({
      user: { connect: { id: userId } },
      tokenHash,
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    });
  }

  findByTokenHash(tokenHash: string): Promise<PasswordResetToken | null> {
    return this.passwordResetRepository.findByTokenHash(tokenHash);
  }

  markUsed(id: string): Promise<PasswordResetToken> {
    return this.passwordResetRepository.markUsed(id);
  }

  /** A token is usable if it exists, hasn't been used, and hasn't expired. */
  isUsable(token: PasswordResetToken): boolean {
    return !token.usedAt && token.expiresAt.getTime() > Date.now();
  }
}
