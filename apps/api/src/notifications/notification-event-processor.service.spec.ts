import { NotificationEventProcessorService } from './notification-event-processor.service';
import { NotificationMessageBuilder } from './notification-message-builder';
import { NotificationRecipientResolver } from './notification-recipient-resolver';

describe('NotificationEventProcessorService', () => {
  const baseEvent = {
    id: 'event-1',
    organisationId: 'org-1',
    workflowInstanceId: 'instance-1',
    workflowDefinitionId: 'def-1',
    workflowDefinitionVersion: 1,
    subjectType: 'PURCHASE_ORDER',
    subjectId: 'po-1',
    subjectReference: null,
    eventType: 'APPROVAL_REQUIRED',
    actorUserId: null,
    targetUserId: null,
    workflowStepInstanceId: 'step-instance-1',
    correlationId: 'corr-1',
    idempotencyKey: 'step-instance-1:APPROVAL_REQUIRED',
    summary: {},
    occurredAt: new Date(),
    notificationProcessedAt: null,
    notificationAttempts: 0,
    notificationLastAttemptAt: null,
    notificationLastError: null,
  };

  const instance = {
    id: 'instance-1',
    organisationId: 'org-1',
    workflowDefinitionId: 'def-1',
    subjectType: 'PURCHASE_ORDER',
    subjectId: 'po-1',
    requestedById: 'requester-1',
    previousInstanceId: null,
    stepInstances: [
      {
        id: 'step-instance-1',
        sequence: 1,
        status: 'ACTIVE',
        stepNameSnapshot: 'Procurement Review',
        requiredPermissionSnapshot: 'procurement.purchase_order.approve',
        requiredScopeSnapshot: 'ORGANISATION',
        assignedUserIdSnapshot: null,
      },
    ],
  };

  function makePrisma(overrides: Record<string, unknown> = {}) {
    const tx = {
      notification: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      workflowEvent: { update: jest.fn().mockResolvedValue(undefined) },
    };
    return {
      workflowEvent: {
        findMany: jest.fn().mockResolvedValue([baseEvent]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      workflowInstance: { findUnique: jest.fn().mockResolvedValue(instance) },
      $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => fn(tx)),
      __tx: tx,
      ...overrides,
    };
  }

  function makeService(prisma = makePrisma()) {
    const recipientResolver = {
      resolve: jest.fn().mockResolvedValue(['approver-1']),
    } as unknown as jest.Mocked<NotificationRecipientResolver>;
    const messageBuilder = {
      build: jest.fn().mockResolvedValue({
        type: 'WORKFLOW_APPROVAL_REQUIRED',
        title: 'Approval required',
        body: 'Purchase Order PO-1 needs your approval.',
        actionUrl: '/settings/workflows/instances/instance-1',
      }),
    } as unknown as jest.Mocked<NotificationMessageBuilder>;

    const service = new NotificationEventProcessorService(
      prisma as never,
      recipientResolver,
      messageBuilder,
    );
    return { service, prisma, recipientResolver, messageBuilder };
  }

  it('creates one notification per resolved recipient and marks the event processed', async () => {
    const { service, prisma } = makeService();
    const result = await service.processPendingEvents('org-1');

    expect(result).toEqual({ processed: 1, failed: 0, notificationsCreated: 1 });
    const tx = (prisma as ReturnType<typeof makePrisma>).__tx;
    expect(tx.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            organisationId: 'org-1',
            recipientUserId: 'approver-1',
            sourceEventId: 'event-1',
            type: 'WORKFLOW_APPROVAL_REQUIRED',
          }),
        ],
        skipDuplicates: true,
      }),
    );
    expect(tx.workflowEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'event-1' },
        data: expect.objectContaining({ notificationLastError: null }),
      }),
    );
  });

  it('is tenant-scoped: only queries WorkflowEvent rows for the given organisationId', async () => {
    const { service, prisma } = makeService();
    await service.processPendingEvents('org-1');
    expect(prisma.workflowEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organisationId: 'org-1' }) }),
    );
  });

  it('deduplicates recipients before building/creating notifications', async () => {
    const prisma = makePrisma();
    const { service, recipientResolver } = makeService(prisma);
    recipientResolver.resolve.mockResolvedValue(['approver-1', 'approver-1']);

    await service.processPendingEvents('org-1');

    const tx = (prisma as ReturnType<typeof makePrisma>).__tx;
    expect(tx.notification.createMany.mock.calls[0][0].data).toHaveLength(1);
  });

  it('creates zero notifications and still marks processed when there are no recipients', async () => {
    const prisma = makePrisma();
    const { service, recipientResolver, messageBuilder } = makeService(prisma);
    recipientResolver.resolve.mockResolvedValue([]);

    const result = await service.processPendingEvents('org-1');

    expect(result).toEqual({ processed: 1, failed: 0, notificationsCreated: 0 });
    expect(messageBuilder.build).not.toHaveBeenCalled();
    const tx = (prisma as ReturnType<typeof makePrisma>).__tx;
    expect(tx.notification.createMany).not.toHaveBeenCalled();
    expect(tx.workflowEvent.update).toHaveBeenCalled();
  });

  it('does NOT mark the event processed when notification creation fails, and records the error', async () => {
    const prisma = makePrisma();
    prisma.$transaction = jest.fn().mockRejectedValue(new Error('db exploded'));
    const { service } = makeService(prisma);

    const result = await service.processPendingEvents('org-1');

    expect(result).toEqual({ processed: 0, failed: 1, notificationsCreated: 0 });
    expect(prisma.workflowEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'event-1' },
        data: expect.objectContaining({
          notificationAttempts: { increment: 1 },
          notificationLastError: expect.stringContaining('db exploded'),
        }),
      }),
    );
  });

  it('one event failing does not block processing of another event in the same batch', async () => {
    const secondEvent = { ...baseEvent, id: 'event-2' };
    const prisma = makePrisma();
    prisma.workflowEvent.findMany = jest.fn().mockResolvedValue([baseEvent, secondEvent]);
    let call = 0;
    prisma.$transaction = jest.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => {
      call++;
      if (call === 1) throw new Error('first one fails');
      return fn((prisma as ReturnType<typeof makePrisma>).__tx);
    });
    const { service } = makeService(prisma);

    const result = await service.processPendingEvents('org-1');

    expect(result).toEqual({ processed: 1, failed: 1, notificationsCreated: 1 });
  });

  it('relies on the DB-level skipDuplicates guarantee for idempotent reprocessing (never a manual pre-check)', async () => {
    const { service, prisma } = makeService();
    await service.processPendingEvents('org-1');
    const tx = (prisma as ReturnType<typeof makePrisma>).__tx;
    expect(tx.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it('marks an event processed with zero notifications when its instance no longer exists, rather than retrying forever', async () => {
    const prisma = makePrisma();
    prisma.workflowInstance.findUnique = jest.fn().mockResolvedValue(null);
    const { service, messageBuilder } = makeService(prisma);

    const result = await service.processPendingEvents('org-1');

    expect(result).toEqual({ processed: 1, failed: 0, notificationsCreated: 0 });
    expect(messageBuilder.build).not.toHaveBeenCalled();
    expect(prisma.workflowEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'event-1' },
        data: { notificationProcessedAt: expect.any(Date) },
      }),
    );
  });
});
