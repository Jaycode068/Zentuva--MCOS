import {
  ALLOWED_TEST_DATABASES,
  EXPECTED_TEST_ROLE,
  UnsafeTestDatabaseError,
  assertSafeTestIdentity,
  requireTestDatabaseUrl,
  verifyConnectedToTestDatabase,
} from './test-db-guard';

const safeIdentity = {
  database: ALLOWED_TEST_DATABASES[0],
  user: EXPECTED_TEST_ROLE,
  rolsuper: false,
  rolcreatedb: false,
  rolcreaterole: false,
  rolbypassrls: false,
};

describe('test-db-guard (pure decision logic — no database connection)', () => {
  describe('assertSafeTestIdentity', () => {
    it('does not throw for the genuinely isolated test identity', () => {
      expect(() => assertSafeTestIdentity(safeIdentity)).not.toThrow();
    });

    // Scenario 2 (guard-level, non-connecting): an operational-looking target must be
    // rejected before any mutation could occur. This mirrors the actual operational
    // connection's reported identity from the Phase 2C review — same database name, same
    // role name, same superuser flags — WITHOUT connecting to any real database.
    it('rejects an operational-looking identity (superuser role, operational database name)', () => {
      expect(() =>
        assertSafeTestIdentity({
          database: 'zentuva',
          user: 'zentuva',
          rolsuper: true,
          rolcreatedb: true,
          rolcreaterole: true,
          rolbypassrls: true,
        }),
      ).toThrow(UnsafeTestDatabaseError);
    });

    it('rejects when the database name is not on the allowlist, even if the role name matches', () => {
      expect(() => assertSafeTestIdentity({ ...safeIdentity, database: 'zentuva' })).toThrow(
        UnsafeTestDatabaseError,
      );
    });

    it('rejects when the role name does not match, even if the database name is on the allowlist', () => {
      expect(() => assertSafeTestIdentity({ ...safeIdentity, user: 'zentuva' })).toThrow(
        UnsafeTestDatabaseError,
      );
    });

    it('rejects a role with rolsuper=true even if the database and role name both look correct', () => {
      expect(() => assertSafeTestIdentity({ ...safeIdentity, rolsuper: true })).toThrow(
        UnsafeTestDatabaseError,
      );
    });

    it('rejects a role with rolcreatedb=true', () => {
      expect(() => assertSafeTestIdentity({ ...safeIdentity, rolcreatedb: true })).toThrow(
        UnsafeTestDatabaseError,
      );
    });

    it('rejects a role with rolcreaterole=true', () => {
      expect(() => assertSafeTestIdentity({ ...safeIdentity, rolcreaterole: true })).toThrow(
        UnsafeTestDatabaseError,
      );
    });

    it('rejects a role with rolbypassrls=true', () => {
      expect(() => assertSafeTestIdentity({ ...safeIdentity, rolbypassrls: true })).toThrow(
        UnsafeTestDatabaseError,
      );
    });
  });

  describe('requireTestDatabaseUrl', () => {
    const originalEnv = process.env.TEST_DATABASE_URL;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.TEST_DATABASE_URL;
      } else {
        process.env.TEST_DATABASE_URL = originalEnv;
      }
    });

    // Scenario 3: a missing test database URL must fail clearly, with no fallback to
    // DATABASE_URL (the operational variable is never read by this function at all).
    it('throws when TEST_DATABASE_URL is unset', () => {
      delete process.env.TEST_DATABASE_URL;
      expect(() => requireTestDatabaseUrl()).toThrow(UnsafeTestDatabaseError);
    });

    it('throws when TEST_DATABASE_URL is an empty string', () => {
      process.env.TEST_DATABASE_URL = '   ';
      expect(() => requireTestDatabaseUrl()).toThrow(UnsafeTestDatabaseError);
    });

    it('returns the configured value when present', () => {
      process.env.TEST_DATABASE_URL = 'postgresql://zentuva_test:x@localhost:5433/zentuva_test';
      expect(requireTestDatabaseUrl()).toBe(
        'postgresql://zentuva_test:x@localhost:5433/zentuva_test',
      );
    });

    // Scenario 4 (part 1): this function's contract is that it is the ONLY source of the
    // test connection string — there is no code path in it that reads DATABASE_URL, so a
    // conflicting operational DATABASE_URL value cannot influence its result.
    it('ignores DATABASE_URL entirely, even when TEST_DATABASE_URL is unset', () => {
      const originalDatabaseUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = 'postgresql://zentuva:x@localhost:5432/zentuva';
      delete process.env.TEST_DATABASE_URL;
      try {
        expect(() => requireTestDatabaseUrl()).toThrow(UnsafeTestDatabaseError);
      } finally {
        if (originalDatabaseUrl === undefined) {
          delete process.env.DATABASE_URL;
        } else {
          process.env.DATABASE_URL = originalDatabaseUrl;
        }
      }
    });
  });

  describe('verifyConnectedToTestDatabase (mocked $queryRaw — decision logic only, no real connection)', () => {
    // Scenario 4 (part 2): a conflicting/mismatched connected identity — simulated here via
    // a mocked query result rather than a real connection, per the task's explicit
    // instruction to test this scenario with "a safe, non-operational fixture or a
    // controlled guard-level test" rather than against real operational infrastructure.
    it('rejects when the live query reports an operational-looking identity', async () => {
      const mockPrisma = {
        $queryRaw: jest.fn().mockResolvedValue([
          {
            current_database: 'zentuva',
            current_user: 'zentuva',
            rolsuper: true,
            rolcreatedb: true,
            rolcreaterole: true,
            rolbypassrls: true,
          },
        ]),
      };
      await expect(verifyConnectedToTestDatabase(mockPrisma)).rejects.toThrow(
        UnsafeTestDatabaseError,
      );
    });

    it('resolves when the live query reports the genuinely isolated test identity', async () => {
      const mockPrisma = {
        $queryRaw: jest.fn().mockResolvedValue([
          {
            current_database: 'zentuva_test',
            current_user: 'zentuva_test',
            rolsuper: false,
            rolcreatedb: false,
            rolcreaterole: false,
            rolbypassrls: false,
          },
        ]),
      };
      await expect(verifyConnectedToTestDatabase(mockPrisma)).resolves.toBeUndefined();
    });

    it('rejects when the role lookup returns no row at all', async () => {
      const mockPrisma = { $queryRaw: jest.fn().mockResolvedValue([]) };
      await expect(verifyConnectedToTestDatabase(mockPrisma)).rejects.toThrow(
        UnsafeTestDatabaseError,
      );
    });
  });
});
