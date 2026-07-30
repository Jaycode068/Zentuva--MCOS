import { ConfigService } from '@nestjs/config';

import { BcryptPasswordHasher } from './bcrypt-password-hasher';

describe('BcryptPasswordHasher', () => {
  function makeHasher(saltRounds = 4): BcryptPasswordHasher {
    // Low salt rounds in tests only — keeps the suite fast. Production default is 12
    // (BCRYPT_SALT_ROUNDS, apps/api/.env.example).
    const config = { get: jest.fn().mockReturnValue(saltRounds) } as unknown as ConfigService;
    return new BcryptPasswordHasher(config);
  }

  it('hashes a password to something other than the plaintext', async () => {
    const hasher = makeHasher();
    const hash = await hasher.hash('correct horse battery staple');
    expect(hash).not.toBe('correct horse battery staple');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('produces a bcrypt-formatted hash (never plaintext)', async () => {
    const hasher = makeHasher();
    const hash = await hasher.hash('hunter2');
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
  });

  it('compare() returns true for the correct password', async () => {
    const hasher = makeHasher();
    const hash = await hasher.hash('my-secret-password');
    await expect(hasher.compare('my-secret-password', hash)).resolves.toBe(true);
  });

  it('compare() returns false for an incorrect password', async () => {
    const hasher = makeHasher();
    const hash = await hasher.hash('my-secret-password');
    await expect(hasher.compare('wrong-password', hash)).resolves.toBe(false);
  });

  it('honours the configured salt rounds', async () => {
    const hasher = makeHasher(6);
    const hash = await hasher.hash('password');
    // bcrypt hash format: $2b$<rounds>$<salt><hash>
    expect(hash.split('$')[2]).toBe('06');
  });
});
