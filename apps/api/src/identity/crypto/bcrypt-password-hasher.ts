import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

import { PasswordHasher } from './password-hasher.port';

/**
 * bcrypt implementation of {@link PasswordHasher} (Sprint 1B.2 brief §1). Salt rounds are
 * configurable via `BCRYPT_SALT_ROUNDS` — never hardcoded.
 */
@Injectable()
export class BcryptPasswordHasher implements PasswordHasher {
  private readonly saltRounds: number;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.saltRounds = config.get<number>('auth.bcryptSaltRounds', 12);
  }

  hash(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, this.saltRounds);
  }

  compare(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
  }
}
