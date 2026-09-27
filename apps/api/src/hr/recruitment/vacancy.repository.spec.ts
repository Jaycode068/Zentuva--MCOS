import { VacancyRepository } from './vacancy.repository';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Sprint 30.1 — Public Recruitment Experience & Candidate Application Flow
 * (docs/domains/recruitment.md §"Published Vacancy Rules"). Every other
 * recruitment test mocks `VacancyRepository` itself, so nothing previously
 * exercised the actual `WHERE` clause `findPublicList`/`findPublicBySlug`
 * send to Prisma — the ONE place the "published, not expired" visibility
 * rule is actually enforced. This fakes just enough of `prisma.vacancy` to
 * evaluate that clause for real against a small fixture set, matching this
 * codebase's existing in-memory-fake repository-spec convention (see
 * `asset-meter.repository.spec.ts`) rather than hitting a real database.
 */
describe('VacancyRepository public visibility rules', () => {
  const ORG = 'org-1';
  const now = new Date('2026-09-26T00:00:00.000Z');

  const fixtures = [
    {
      id: 'v-published-open',
      organisationId: ORG,
      publicSlug: 'published-open',
      status: 'PUBLISHED',
      applicationDeadline: null,
    },
    {
      id: 'v-published-future',
      organisationId: ORG,
      publicSlug: 'published-future',
      status: 'PUBLISHED',
      applicationDeadline: new Date('2026-12-01'),
    },
    {
      id: 'v-published-expired',
      organisationId: ORG,
      publicSlug: 'published-expired',
      status: 'PUBLISHED',
      applicationDeadline: new Date('2026-01-01'),
    },
    {
      id: 'v-draft',
      organisationId: ORG,
      publicSlug: 'draft-role',
      status: 'DRAFT',
      applicationDeadline: null,
    },
    {
      id: 'v-paused',
      organisationId: ORG,
      publicSlug: 'paused-role',
      status: 'PAUSED',
      applicationDeadline: null,
    },
    {
      id: 'v-closed',
      organisationId: ORG,
      publicSlug: 'closed-role',
      status: 'CLOSED',
      applicationDeadline: null,
    },
    {
      id: 'v-cancelled',
      organisationId: ORG,
      publicSlug: 'cancelled-role',
      status: 'CANCELLED',
      applicationDeadline: null,
    },
    {
      id: 'v-other-org',
      organisationId: 'org-2',
      publicSlug: 'published-open',
      status: 'PUBLISHED',
      applicationDeadline: null,
    },
  ];

  function matches(vacancy: (typeof fixtures)[number], where: Record<string, unknown>): boolean {
    if (where.organisationId !== undefined && vacancy.organisationId !== where.organisationId)
      return false;
    if (where.status !== undefined && vacancy.status !== where.status) return false;
    if (where.publicSlug !== undefined && vacancy.publicSlug !== where.publicSlug) return false;
    const or = where.OR as Array<Record<string, unknown>> | undefined;
    if (or) {
      const orMatch = or.some((clause) => {
        if ('applicationDeadline' in clause) {
          const cond = clause.applicationDeadline;
          if (cond === null) return vacancy.applicationDeadline === null;
          const gte = (cond as { gte: Date }).gte;
          return vacancy.applicationDeadline !== null && vacancy.applicationDeadline >= gte;
        }
        return false;
      });
      if (!orMatch) return false;
    }
    return true;
  }

  function makeRepository() {
    const prisma = {
      vacancy: {
        findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(fixtures.filter((v) => matches(v, where))),
        ),
        findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(fixtures.find((v) => matches(v, where)) ?? null),
        ),
      },
    } as unknown as PrismaService;
    return new VacancyRepository(prisma);
  }

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(now);
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  describe('findPublicList', () => {
    it('includes only PUBLISHED vacancies with no deadline or a future deadline, scoped to the org', async () => {
      const repository = makeRepository();

      const result = await repository.findPublicList(ORG);

      expect(result.map((v) => v.publicSlug)).toEqual(['published-open', 'published-future']);
    });

    it.each(['DRAFT', 'PAUSED', 'CLOSED', 'CANCELLED'])('excludes %s vacancies', async (status) => {
      const repository = makeRepository();

      const result = await repository.findPublicList(ORG);

      expect(result.some((v) => v.status === status)).toBe(false);
    });

    it('excludes a PUBLISHED vacancy whose application deadline has passed', async () => {
      const repository = makeRepository();

      const result = await repository.findPublicList(ORG);

      expect(result.some((v) => v.publicSlug === 'published-expired')).toBe(false);
    });

    it("never returns another organisation's vacancy, even with the same public slug", async () => {
      const repository = makeRepository();

      const result = await repository.findPublicList(ORG);

      expect(result.every((v) => v.organisationId === ORG)).toBe(true);
    });
  });

  describe('findPublicBySlug', () => {
    it('returns a published, non-expired vacancy by slug', async () => {
      const repository = makeRepository();

      const result = await repository.findPublicBySlug(ORG, 'published-open');

      expect(result?.id).toBe('v-published-open');
    });

    it.each(['draft-role', 'paused-role', 'closed-role', 'cancelled-role', 'published-expired'])(
      'returns null for an unavailable vacancy slug (%s)',
      async (slug) => {
        const repository = makeRepository();

        const result = await repository.findPublicBySlug(ORG, slug);

        expect(result).toBeNull();
      },
    );

    it('returns null for a slug that only exists in another organisation (no cross-tenant leak)', async () => {
      const repository = makeRepository();

      const result = await repository.findPublicBySlug(ORG, 'published-open-nonexistent-here');
      expect(result).toBeNull();

      // The same slug DOES exist, but under org-2 — must not resolve for org-1.
      const crossTenant = await repository.findPublicBySlug('org-3', 'published-open');
      expect(crossTenant).toBeNull();
    });
  });
});
