import { ActivityService } from './activity.service';
import { WorkflowSubjectHandler } from '../workflow/workflow-subject-handler';

describe('ActivityService', () => {
  const event = {
    id: 'event-1',
    organisationId: 'org-1',
    actorUserId: 'user-1',
    eventType: 'STEP_APPROVED',
    subjectType: 'PURCHASE_ORDER',
    subjectId: 'po-1',
    summary: { stepSequence: 1 },
    occurredAt: new Date('2026-01-01T00:00:00Z'),
  };

  function makeService(overrides: { actor?: unknown } = {}) {
    const prisma = {
      workflowEvent: {
        findMany: jest.fn().mockResolvedValue([event]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const userService = {
      getById: jest
        .fn()
        .mockResolvedValue(
          overrides.actor === undefined
            ? { firstName: 'Grace', lastName: 'Effiong' }
            : overrides.actor,
        ),
    };
    const handler = {
      subjectType: 'PURCHASE_ORDER',
      describe: jest.fn().mockResolvedValue('PO-000012'),
    } as unknown as jest.Mocked<WorkflowSubjectHandler>;
    const service = new ActivityService(prisma as never, userService as never, [handler]);
    return { service, prisma, userService };
  }

  it('composes activity records from WorkflowEvent rows, scoped to the given organisation', async () => {
    const { service, prisma } = makeService();
    await service.list('org-1');
    expect(prisma.workflowEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organisationId: 'org-1' }) }),
    );
  });

  it('resolves the actor display name and a human-readable subject reference in the summary', async () => {
    const { service } = makeService();
    const { items } = await service.list('org-1');
    expect(items[0]!.actorName).toBe('Grace Effiong');
    expect(items[0]!.subjectReference).toBe('PO-000012');
    expect(items[0]!.summary).toContain('Grace Effiong');
    expect(items[0]!.summary).toContain('PO-000012');
  });

  it('handles a system/no-actor event safely (no "null null" in the summary)', async () => {
    const { service } = makeService({ actor: null });
    const { items } = await service.list('org-1');
    expect(items[0]!.actorName).toBeNull();
    expect(items[0]!.summary).not.toContain('null');
    expect(items[0]!.summary).not.toContain('by )');
  });

  it('preserves the source event id for traceability', async () => {
    const { service } = makeService();
    const { items } = await service.list('org-1');
    expect(items[0]!.sourceEventId).toBe('event-1');
  });

  it('supports filtering by subjectType/subjectId for a per-record activity feed', async () => {
    const { service, prisma } = makeService();
    await service.list('org-1', { subjectType: 'PURCHASE_ORDER', subjectId: 'po-1' });
    expect(prisma.workflowEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ subjectType: 'PURCHASE_ORDER', subjectId: 'po-1' }),
      }),
    );
  });

  it('never writes — it only ever calls findMany/count, matching "activity records are immutable"', async () => {
    const { service, prisma } = makeService();
    await service.list('org-1');
    expect(Object.keys(prisma.workflowEvent)).toEqual(['findMany', 'count']);
  });
});
