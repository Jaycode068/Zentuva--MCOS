import { Module } from '@nestjs/common';

import { BcryptPasswordHasher } from './bcrypt-password-hasher';
import { PASSWORD_HASHER } from './password-hasher.port';

/**
 * Provides {@link PASSWORD_HASHER}. Split out from IdentityModule/AuthModule so both can
 * import it without a circular dependency (UserService needs it too, not just AuthService
 * — see docs/sprint-1B.2-completion-report.md).
 */
@Module({
  providers: [{ provide: PASSWORD_HASHER, useClass: BcryptPasswordHasher }],
  exports: [PASSWORD_HASHER],
})
export class CryptoModule {}
