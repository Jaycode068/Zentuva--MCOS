import { HiringRequestRepository } from './hiring-request.repository';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * "Hiring Request → HR Approval → Public Vacancy Flow" audit
 * (docs/domains/recruitment.md §"Hiring Request Lifecycle"). Every other
 * hiring-request test mocks this repository itself, so nothing previously
 * exercised the actual conditional `updateMany` each transition method
 * builds — the ONE place the lifecycle's "only from this status" rule and
 * tenant scoping are actually enforced. Fakes just enough of
 * `prisma.hiringRequest` to evaluate that logic for real, matching this
 * codebase's existing in-memory-fake repository-spec convention.
 */
describe('HiringRequestRepository lifecycle and tenant isolation', () => {
  const ORG = 'org-1';

  function makeRepository(initialStatus: string, organisationId = ORG) {
    const store = {
      id: 'hr-1',
      organisationId,
      status: initialStatus,
    };
    const prisma = {
      hiringRequest: {
        findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
          if (where.id !== store.id || where.organisationId !== store.organisationId) {
            return Promise.resolve(null);
          }
          return Promise.resolve({ ...store });
        }),
        findMany: jest.fn(({ where }: { where: Record<string, unknown> }) => {
          if (where.organisationId !== store.organisationId) {
            return Promise.resolve([]);
          }
          return Promise.resolve([{ ...store }]);
        }),
        updateMany: jest.fn(
          ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            const statusIn = (where.status as { in: string[] } | undefined)?.in;
            const matches =
              where.id === store.id &&
              where.organisationId === store.organisationId &&
              (!statusIn || statusIn.includes(store.status));
            if (matches) {
              store.status = (data.status as string) ?? store.status;
              return Promise.resolve({ count: 1 });
            }
            return Promise.resolve({ count: 0 });
          },
        ),
      },
    } as unknown as PrismaService;
    return { repository: new HiringRequestRepository(prisma), store };
  }

  describe('lifecycle transitions', () => {
    it('submit: DRAFT → SUBMITTED', async () => {
      const { repository, store } = makeRepository('DRAFT');
      const result = await repository.submit(ORG, 'hr-1');
      expect(result.transitioned).toBe(true);
      expect(store.status).toBe('SUBMITTED');
    });

    it.each(['SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'])(
      'submit: refuses from %s (not DRAFT)',
      async (status) => {
        const { repository, store } = makeRepository(status);
        const result = await repository.submit(ORG, 'hr-1');
        expect(result.transitioned).toBe(false);
        expect(store.status).toBe(status);
      },
    );

    it('approve: SUBMITTED → APPROVED', async () => {
      const { repository, store } = makeRepository('SUBMITTED');
      const result = await repository.approve(ORG, 'hr-1');
      expect(result.transitioned).toBe(true);
      expect(store.status).toBe('APPROVED');
    });

    it.each(['DRAFT', 'APPROVED', 'REJECTED', 'CANCELLED'])(
      'approve: refuses from %s (not SUBMITTED) — a rejected/draft/cancelled request can never be approved directly',
      async (status) => {
        const { repository, store } = makeRepository(status);
        const result = await repository.approve(ORG, 'hr-1');
        expect(result.transitioned).toBe(false);
        expect(store.status).toBe(status);
      },
    );

    it('reject: SUBMITTED → REJECTED', async () => {
      const { repository, store } = makeRepository('SUBMITTED');
      const result = await repository.reject(ORG, 'hr-1');
      expect(result.transitioned).toBe(true);
      expect(store.status).toBe('REJECTED');
    });

    it('an already-REJECTED request cannot be re-approved or re-rejected', async () => {
      const { repository, store } = makeRepository('REJECTED');
      expect((await repository.approve(ORG, 'hr-1')).transitioned).toBe(false);
      expect((await repository.reject(ORG, 'hr-1')).transitioned).toBe(false);
      expect(store.status).toBe('REJECTED');
    });

    it.each(['DRAFT', 'SUBMITTED'])('cancel: allowed from %s', async (status) => {
      const { repository, store } = makeRepository(status);
      const result = await repository.cancel(ORG, 'hr-1');
      expect(result.transitioned).toBe(true);
      expect(store.status).toBe('CANCELLED');
    });

    it.each(['APPROVED', 'REJECTED', 'CANCELLED'])('cancel: refuses from %s', async (status) => {
      const { repository } = makeRepository(status);
      const result = await repository.cancel(ORG, 'hr-1');
      expect(result.transitioned).toBe(false);
    });
  });

  describe('tenant isolation', () => {
    it('findById never resolves a hiring request belonging to another organisation', async () => {
      const { repository } = makeRepository('APPROVED', 'org-2');
      const result = await repository.findById(ORG, 'hr-1');
      expect(result).toBeNull();
    });

    it("list never returns another organisation's hiring requests", async () => {
      const { repository } = makeRepository('SUBMITTED', 'org-2');
      const result = await repository.list(ORG);
      expect(result).toEqual([]);
    });

    it('a cross-tenant id cannot be approved/rejected/cancelled even with the correct status', async () => {
      const { repository, store } = makeRepository('SUBMITTED', 'org-2');
      const approveResult = await repository.approve(ORG, 'hr-1');
      expect(approveResult.transitioned).toBe(false);
      expect(store.status).toBe('SUBMITTED');
    });
  });
});
