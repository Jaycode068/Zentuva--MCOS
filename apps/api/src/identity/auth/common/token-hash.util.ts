import { createHash, randomBytes } from 'node:crypto';

/**
 * Shared helpers for credential-bearing tokens (invitation, password-reset) that are
 * stored hashed per docs/domains/identity.md §9 "Token storage". Deliberately SHA-256,
 * not bcrypt/{@link PasswordHasher}: these are high-entropy random values, not low-entropy
 * human passwords, so a slow salted hash buys nothing and only adds latency — a fast,
 * deterministic hash is the correct tool here (see
 * docs/sprint-1B.2-completion-report.md "Security decisions").
 *
 * Refresh tokens are the one exception: they're JWTs (Sprint 1B.2 brief §2), so their raw
 * form already carries a signature; hashing the JWT string itself before storage is what
 * lets a compromised database dump not directly hand out valid bearer tokens.
 */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
