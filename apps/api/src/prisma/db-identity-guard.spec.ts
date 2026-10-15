import {
  EXPECTED_DEVELOPMENT_DATABASE,
  EXPECTED_DEVELOPMENT_ROLE,
  RECOGNIZED_LOCAL_HOSTS,
  UnsafeDevelopmentDatabaseError,
  assertSafeDevelopmentTarget,
  buildGuardedSubprocessEnv,
  classifyDatabaseIdentity,
  extractHost,
  requireDevelopmentDatabaseUrl,
  verifyConnectedToDevelopmentDatabase,
} from './db-identity-guard';

const safeDevIdentity = {
  host: RECOGNIZED_LOCAL_HOSTS[0],
  database: EXPECTED_DEVELOPMENT_DATABASE,
  user: EXPECTED_DEVELOPMENT_ROLE,
  rolsuper: true,
  rolcreatedb: true,
  rolcreaterole: true,
  rolbypassrls: true,
};

describe('db-identity-guard (pure decision logic — no database connection)', () => {
  describe('extractHost', () => {
    it('extracts the hostname from a well-formed postgres URL', () => {
      expect(extractHost('postgresql://zentuva:x@localhost:5432/zentuva')).toBe('localhost');
    });

    it('extracts a non-local hostname unchanged (classification happens later, not here)', () => {
      expect(extractHost('postgresql://zentuva:x@db.example.com:5432/zentuva')).toBe(
        'db.example.com',
      );
    });

    it('throws UnsafeDevelopmentDatabaseError for an unparsable URL', () => {
      expect(() => extractHost('not a url at all')).toThrow(UnsafeDevelopmentDatabaseError);
    });
  });

  describe('classifyDatabaseIdentity', () => {
    it('classifies the expected development identity as "development"', () => {
      expect(classifyDatabaseIdentity(safeDevIdentity)).toBe('development');
    });

    it('classifies a zentuva_test database as "test", regardless of role name', () => {
      expect(classifyDatabaseIdentity({ ...safeDevIdentity, database: 'zentuva_test' })).toBe(
        'test',
      );
    });

    it('classifies a zentuva_test_app role as "test", regardless of database name', () => {
      expect(classifyDatabaseIdentity({ ...safeDevIdentity, user: 'zentuva_test_app' })).toBe(
        'test',
      );
    });

    it('classifies anything else as "unknown"', () => {
      expect(
        classifyDatabaseIdentity({
          ...safeDevIdentity,
          database: 'some_other_db',
          user: 'some_other_role',
        }),
      ).toBe('unknown');
    });
  });

  describe('assertSafeDevelopmentTarget', () => {
    it('does not throw for the expected development identity', () => {
      expect(() => assertSafeDevelopmentTarget(safeDevIdentity)).not.toThrow();
    });

    it('rejects a non-local host even if database/role names match exactly', () => {
      expect(() =>
        assertSafeDevelopmentTarget({ ...safeDevIdentity, host: 'db.some-real-host.example.com' }),
      ).toThrow(UnsafeDevelopmentDatabaseError);
    });

    // This is the core "distinguish test from development by server-confirmed identity,
    // not just an env var name" requirement — simulates a development script that
    // somehow ended up connected to the isolated test database/role.
    it('rejects when the connection is actually the isolated test database', () => {
      expect(() =>
        assertSafeDevelopmentTarget({
          ...safeDevIdentity,
          database: 'zentuva_test',
          user: 'zentuva_test',
        }),
      ).toThrow(UnsafeDevelopmentDatabaseError);
    });

    it('rejects when the connection is the test runtime-app role, even against a differently-named database', () => {
      expect(() =>
        assertSafeDevelopmentTarget({ ...safeDevIdentity, user: 'zentuva_test_app' }),
      ).toThrow(UnsafeDevelopmentDatabaseError);
    });

    it('rejects an unrecognized database name', () => {
      expect(() =>
        assertSafeDevelopmentTarget({ ...safeDevIdentity, database: 'some_unexpected_db' }),
      ).toThrow(UnsafeDevelopmentDatabaseError);
    });

    it('rejects an unrecognized role name', () => {
      expect(() =>
        assertSafeDevelopmentTarget({ ...safeDevIdentity, user: 'some_unexpected_role' }),
      ).toThrow(UnsafeDevelopmentDatabaseError);
    });

    it('does not reject on the development role being a superuser (documented, known, pre-existing state)', () => {
      expect(() =>
        assertSafeDevelopmentTarget({ ...safeDevIdentity, rolsuper: true }),
      ).not.toThrow();
    });

    // Privilege signature is an IDENTITY signal here, not a restriction: a role merely
    // named zentuva/zentuva that does NOT carry the known signature is not verifiably
    // the genuine development role.
    it('rejects when rolsuper does not match the expected development-role signature', () => {
      expect(() => assertSafeDevelopmentTarget({ ...safeDevIdentity, rolsuper: false })).toThrow(
        UnsafeDevelopmentDatabaseError,
      );
    });

    it('rejects when rolcreatedb does not match the expected development-role signature', () => {
      expect(() => assertSafeDevelopmentTarget({ ...safeDevIdentity, rolcreatedb: false })).toThrow(
        UnsafeDevelopmentDatabaseError,
      );
    });

    it('rejects when rolcreaterole does not match the expected development-role signature', () => {
      expect(() =>
        assertSafeDevelopmentTarget({ ...safeDevIdentity, rolcreaterole: false }),
      ).toThrow(UnsafeDevelopmentDatabaseError);
    });
  });

  describe('requireDevelopmentDatabaseUrl (environment precedence and contradictory-settings coverage)', () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const originalTestDatabaseUrl = process.env.TEST_DATABASE_URL;

    afterEach(() => {
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
      if (originalTestDatabaseUrl === undefined) {
        delete process.env.TEST_DATABASE_URL;
      } else {
        process.env.TEST_DATABASE_URL = originalTestDatabaseUrl;
      }
    });

    it('throws when DATABASE_URL is unset', () => {
      delete process.env.DATABASE_URL;
      expect(() => requireDevelopmentDatabaseUrl()).toThrow(UnsafeDevelopmentDatabaseError);
    });

    it('throws when DATABASE_URL is an empty string', () => {
      process.env.DATABASE_URL = '   ';
      expect(() => requireDevelopmentDatabaseUrl()).toThrow(UnsafeDevelopmentDatabaseError);
    });

    it('returns the configured value when present', () => {
      process.env.DATABASE_URL = 'postgresql://zentuva:x@localhost:5432/zentuva';
      expect(requireDevelopmentDatabaseUrl()).toBe('postgresql://zentuva:x@localhost:5432/zentuva');
    });

    // "Contradictory settings" coverage: an unrelated TEST_DATABASE_URL being ALSO
    // present (e.g. left over from a prior `pnpm test:integration` run in the same
    // shell) must have zero influence on which value a development command resolves to.
    it('ignores TEST_DATABASE_URL entirely, even when it is also set', () => {
      process.env.DATABASE_URL = 'postgresql://zentuva:x@localhost:5432/zentuva';
      process.env.TEST_DATABASE_URL = 'postgresql://zentuva_test:y@localhost:5433/zentuva_test';
      expect(requireDevelopmentDatabaseUrl()).toBe('postgresql://zentuva:x@localhost:5432/zentuva');
    });

    it('still throws when DATABASE_URL is unset, even though a contradictory TEST_DATABASE_URL is present — never falls back to it', () => {
      delete process.env.DATABASE_URL;
      process.env.TEST_DATABASE_URL = 'postgresql://zentuva_test:y@localhost:5433/zentuva_test';
      expect(() => requireDevelopmentDatabaseUrl()).toThrow(UnsafeDevelopmentDatabaseError);
    });
  });

  describe('buildGuardedSubprocessEnv (guard-to-Prisma connection consistency)', () => {
    it('sets DATABASE_URL to exactly the validated value in the returned env', () => {
      const result = buildGuardedSubprocessEnv('postgresql://zentuva:x@localhost:5432/zentuva', {});
      expect(result.DATABASE_URL).toBe('postgresql://zentuva:x@localhost:5432/zentuva');
    });

    // The core "no silent substitution after validation" property: even if the base
    // environment passed in already contains a DIFFERENT DATABASE_URL (e.g. a stale
    // shell export), the validated value must win in the built env — this is what
    // actually reaches the spawned Prisma subprocess.
    it('overrides a different DATABASE_URL already present in the base environment', () => {
      const result = buildGuardedSubprocessEnv('postgresql://zentuva:x@localhost:5432/zentuva', {
        DATABASE_URL: 'postgresql://someone-else:y@some-other-host:5432/some_other_db',
      });
      expect(result.DATABASE_URL).toBe('postgresql://zentuva:x@localhost:5432/zentuva');
    });

    it('preserves every other variable from the base environment unchanged', () => {
      const result = buildGuardedSubprocessEnv('postgresql://zentuva:x@localhost:5432/zentuva', {
        PATH: '/usr/bin',
        NODE_ENV: 'development',
      });
      expect(result.PATH).toBe('/usr/bin');
      expect(result.NODE_ENV).toBe('development');
    });
  });

  describe('verifyConnectedToDevelopmentDatabase (mocked $queryRaw — decision logic only, no real connection)', () => {
    it('resolves for the expected development identity', async () => {
      const mockPrisma = {
        $queryRaw: jest.fn().mockResolvedValue([
          {
            current_database: EXPECTED_DEVELOPMENT_DATABASE,
            current_user: EXPECTED_DEVELOPMENT_ROLE,
            rolsuper: true,
            rolcreatedb: true,
            rolcreaterole: true,
            rolbypassrls: true,
          },
        ]),
      };
      await expect(
        verifyConnectedToDevelopmentDatabase(
          mockPrisma,
          'postgresql://zentuva:x@localhost:5432/zentuva',
        ),
      ).resolves.toBeUndefined();
    });

    it('rejects when the live query reports the isolated test identity', async () => {
      const mockPrisma = {
        $queryRaw: jest
          .fn()
          .mockResolvedValue([
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
      await expect(
        verifyConnectedToDevelopmentDatabase(
          mockPrisma,
          'postgresql://zentuva_test:x@localhost:5433/zentuva_test',
        ),
      ).rejects.toThrow(UnsafeDevelopmentDatabaseError);
    });

    it('rejects when the URL host is not local, even if the server-reported identity looks right', async () => {
      const mockPrisma = {
        $queryRaw: jest
          .fn()
          .mockResolvedValue([
            {
              current_database: EXPECTED_DEVELOPMENT_DATABASE,
              current_user: EXPECTED_DEVELOPMENT_ROLE,
              rolsuper: true,
              rolcreatedb: true,
              rolcreaterole: true,
              rolbypassrls: true,
            },
          ]),
      };
      await expect(
        verifyConnectedToDevelopmentDatabase(
          mockPrisma,
          'postgresql://zentuva:x@some-remote-host.example.com:5432/zentuva',
        ),
      ).rejects.toThrow(UnsafeDevelopmentDatabaseError);
    });

    it('rejects when the role lookup returns no row at all', async () => {
      const mockPrisma = { $queryRaw: jest.fn().mockResolvedValue([]) };
      await expect(
        verifyConnectedToDevelopmentDatabase(
          mockPrisma,
          'postgresql://zentuva:x@localhost:5432/zentuva',
        ),
      ).rejects.toThrow(UnsafeDevelopmentDatabaseError);
    });
  });
});
