import { ConflictException, NotFoundException } from '@nestjs/common';

import { NotificationEventProcessorService } from './notification-event-processor.service';
import { MAX_PROCESSING_ATTEMPTS } from './notification-processing.constants';
import { NotificationMessageBuilder } from './notification-message-builder';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationRecipientResolver } from './notification-recipient-resolver';

describe('NotificationEventProcessorService', () => {
  function makeEvent(overrides: Record<string, unknown> = {}) {
    return {
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
      notificationFirstAttemptAt: null,
      notificationLastAttemptAt: null,
      notificationLastError: null,
      notificationLastErrorCategory: null,
      notificationProcessingStatus: 'PENDING',
      notificationLeaseAt: null,
      notificationNextRetryAt: null,
      ...overrides,
    };
  }

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

  function makePrisma(events = [makeEvent()], overrides: Record<string, unknown> = {}) {
    const tx = {
      notification: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      workflowEvent: { update: jest.fn().mockResolvedValue(undefined) },
    };
    return {
      workflowEvent: {
        findMany: jest.fn().mockResolvedValue(events),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(undefined),
        findFirst: jest.fn().mockResolvedValue(events[0] ?? null),
        findFirstOrThrow: jest.fn().mockResolvedValue(events[0]),
        count: jest.fn().mockResolvedValue(events.length),
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
    const preferenceService = {
      filterEnabledRecipients: jest.fn().mockImplementation((_org, ids) => Promise.resolve(ids)),
    } as unknown as jest.Mocked<NotificationPreferenceService>;

    const service = new NotificationEventProcessorService(
      prisma as never,
      recipientResolver,
      messageBuilder,
      preferenceService,
    );
    return { service, prisma, recipientResolver, messageBuilder, preferenceService };
  }

  describe('successful processing', () => {
    it('claims a PENDING event, creates notifications, and marks it PROCESSED', async () => {
      const { service, prisma } = makeService();
      const result = await service.processPendingEvents('org-1');

      expect(result).toEqual({ processed: 1, failed: 0, notificationsCreated: 1 });
      const tx = (prisma as ReturnType<typeof makePrisma>).__tx;
      expect(tx.workflowEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ notificationProcessingStatus: 'PROCESSED' }),
        }),
      );
    });

    it('is tenant-scoped: only claims WorkflowEvent rows for the given organisationId', async () => {
      const { service, prisma } = makeService();
      await service.processPendingEvents('org-1');
      expect(prisma.workflowEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organisationId: 'org-1' }) }),
      );
    });

    it('filters recipients through NotificationPreferenceService before creating rows', async () => {
      const { service, preferenceService } = makeService();
      await service.processPendingEvents('org-1');
      expect(preferenceService.filterEnabledRecipients).toHaveBeenCalledWith(
        'org-1',
        ['approver-1'],
        'WORKFLOW_APPROVALS',
      );
    });

    it('deduplicates recipients (§5.2 "duplicate recipient paths") before building/creating notifications', async () => {
      const prisma = makePrisma();
      const {
        service,
        recipientResolver,
        prisma: p,
      } = (() => {
        const s = makeService(prisma);
        return { ...s, prisma: s.prisma };
      })();
      recipientResolver.resolve.mockResolvedValue(['approver-1', 'approver-1']);

      await service.processPendingEvents('org-1');

      const tx = (p as ReturnType<typeof makePrisma>).__tx;
      expect(tx.notification.createMany.mock.calls[0][0].data).toHaveLength(1);
    });

    it('a recipient with the category disabled receives no notification, but the event still reaches PROCESSED', async () => {
      const prisma = makePrisma();
      const { service, preferenceService } = makeService(prisma);
      preferenceService.filterEnabledRecipients.mockResolvedValue([]);

      const result = await service.processPendingEvents('org-1');

      expect(result.notificationsCreated).toBe(0);
      const tx = (prisma as ReturnType<typeof makePrisma>).__tx;
      expect(tx.notification.createMany).not.toHaveBeenCalled();
      expect(tx.workflowEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ notificationProcessingStatus: 'PROCESSED' }),
        }),
      );
    });
  });

  describe('duplicate / concurrent processing', () => {
    it('does not claim a PROCESSED event a second time (excluded from the candidate query by construction)', async () => {
      const processed = makeEvent({ notificationProcessingStatus: 'PROCESSED' });
      const prisma = makePrisma([]); // the real DB query would never return a PROCESSED row
      const { service } = makeService(prisma);
      const result = await service.processPendingEvents('org-1');
      expect(result).toEqual({ processed: 0, failed: 0, notificationsCreated: 0 });
      void processed;
    });

    it("concurrent claim attempts on the same event: the loser's updateMany affects zero rows and it is excluded from the claimed batch", async () => {
      const prisma = makePrisma();
      // Simulate a concurrent process having already claimed this row an instant earlier.
      prisma.workflowEvent.updateMany = jest.fn().mockResolvedValue({ count: 0 });
      const { service, recipientResolver } = makeService(prisma);

      const result = await service.processPendingEvents('org-1');

      expect(result).toEqual({ processed: 0, failed: 0, notificationsCreated: 0 });
      expect(recipientResolver.resolve).not.toHaveBeenCalled();
    });

    it('relies on the DB-level skipDuplicates guarantee, never a manual pre-check, for the actual Notification insert', async () => {
      const { service, prisma } = makeService();
      await service.processPendingEvents('org-1');
      const tx = (prisma as ReturnType<typeof makePrisma>).__tx;
      expect(tx.notification.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true }),
      );
    });
  });

  describe('retryable failure', () => {
    it('a failed attempt (attempts remaining) returns to PENDING with a scheduled retry, not FAILED', async () => {
      const prisma = makePrisma();
      prisma.$transaction = jest.fn().mockRejectedValue(new Error('transient db error'));
      const { service } = makeService(prisma);

      const result = await service.processPendingEvents('org-1');

      expect(result).toEqual({ processed: 0, failed: 1, notificationsCreated: 0 });
      expect(prisma.workflowEvent.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'event-1', notificationProcessingStatus: 'PROCESSING' },
          data: expect.objectContaining({
            notificationProcessingStatus: 'PENDING',
            notificationNextRetryAt: expect.any(Date),
            notificationLastError: expect.stringContaining('transient db error'),
          }),
        }),
      );
    });

    it('one event failing does not block processing of another event in the same batch', async () => {
      const first = makeEvent({ id: 'event-1' });
      const second = makeEvent({ id: 'event-2' });
      const prisma = makePrisma([first, second]);
      let call = 0;
      prisma.$transaction = jest.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => {
        call++;
        if (call === 1) throw new Error('first fails');
        return fn((prisma as ReturnType<typeof makePrisma>).__tx);
      });
      const { service } = makeService(prisma);

      const result = await service.processPendingEvents('org-1');

      expect(result).toEqual({ processed: 1, failed: 1, notificationsCreated: 1 });
    });
  });

  describe('terminal failure / max attempts', () => {
    it('becomes FAILED once attempts reach MAX_PROCESSING_ATTEMPTS', async () => {
      const event = makeEvent({ notificationAttempts: MAX_PROCESSING_ATTEMPTS - 1 });
      const prisma = makePrisma([event]);
      prisma.$transaction = jest.fn().mockRejectedValue(new Error('still failing'));
      const { service } = makeService(prisma);

      await service.processPendingEvents('org-1');

      expect(prisma.workflowEvent.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            notificationProcessingStatus: 'FAILED',
            notificationNextRetryAt: null,
          }),
        }),
      );
    });
  });

  describe('stale PROCESSING recovery', () => {
    it("claimBatch's candidate query includes stale PROCESSING rows alongside due PENDING rows", async () => {
      const { service, prisma } = makeService();
      await service.processPendingEvents('org-1');
      const where = (prisma.workflowEvent.findMany as jest.Mock).mock.calls[0][0].where;
      expect(JSON.stringify(where)).toContain('PROCESSING');
      expect(JSON.stringify(where)).toContain('notificationLeaseAt');
    });
  });

  describe('manual retry', () => {
    it('retryEvent resets a FAILED event to PENDING with an immediate retry time', async () => {
      const event = makeEvent({ notificationProcessingStatus: 'FAILED' });
      const prisma = makePrisma([event]);
      const { service } = makeService(prisma);

      await service.retryEvent('org-1', 'event-1');

      expect(prisma.workflowEvent.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'event-1',
            organisationId: 'org-1',
            notificationProcessingStatus: { in: ['FAILED', 'PROCESSING'] },
          },
          data: expect.objectContaining({
            notificationProcessingStatus: 'PENDING',
            notificationNextRetryAt: expect.any(Date),
          }),
        }),
      );
    });

    it('retryEvent does NOT reset notificationAttempts (full history preserved)', async () => {
      const event = makeEvent({ notificationProcessingStatus: 'FAILED', notificationAttempts: 3 });
      const prisma = makePrisma([event]);
      const { service } = makeService(prisma);
      await service.retryEvent('org-1', 'event-1');
      const call = (prisma.workflowEvent.updateMany as jest.Mock).mock.calls[0][0];
      expect(call.data.notificationAttempts).toBeUndefined();
    });

    it('retryEvent rejects a PROCESSED event as already succeeded', async () => {
      const event = makeEvent({ notificationProcessingStatus: 'PROCESSED' });
      const prisma = makePrisma([event]);
      const { service } = makeService(prisma);
      await expect(service.retryEvent('org-1', 'event-1')).rejects.toThrow(ConflictException);
    });

    it("retryEvent 404s for an event outside the caller's organisation", async () => {
      const prisma = makePrisma([]);
      prisma.workflowEvent.findFirst = jest.fn().mockResolvedValue(null);
      const { service } = makeService(prisma);
      await expect(service.retryEvent('org-2', 'event-1')).rejects.toThrow(NotFoundException);
    });

    it('retry after partial notification creation does not create a duplicate — the eventual processOne call still uses skipDuplicates', async () => {
      const event = makeEvent({ notificationProcessingStatus: 'FAILED', notificationAttempts: 2 });
      const prisma = makePrisma([event]);
      const { service, prisma: reProcessPrisma } = (() => {
        const s = makeService(prisma);
        return { service: s.service, prisma: s.prisma };
      })();
      await service.retryEvent('org-1', 'event-1');
      // Simulate the next sweep picking it back up as PENDING.
      const pendingAgain = makeEvent({ id: 'event-1', notificationProcessingStatus: 'PENDING' });
      (reProcessPrisma.workflowEvent.findMany as jest.Mock).mockResolvedValue([pendingAgain]);
      await service.processPendingEvents('org-1');
      const tx = (reProcessPrisma as ReturnType<typeof makePrisma>).__tx;
      expect(tx.notification.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true }),
      );
    });
  });

  describe('listProcessingRecords', () => {
    it('is tenant-scoped and supports status filtering', async () => {
      const { service, prisma } = makeService();
      await service.listProcessingRecords('org-1', { status: 'FAILED' });
      expect(prisma.workflowEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organisationId: 'org-1', notificationProcessingStatus: 'FAILED' },
        }),
      );
      expect(prisma.workflowEvent.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organisationId: 'org-1', notificationProcessingStatus: 'FAILED' },
        }),
      );
    });
  });

  describe('instance no longer reachable', () => {
    it('marks the event PROCESSED with zero notifications rather than retrying forever', async () => {
      const prisma = makePrisma();
      prisma.workflowInstance.findUnique = jest.fn().mockResolvedValue(null);
      const { service, messageBuilder } = makeService(prisma);

      const result = await service.processPendingEvents('org-1');

      expect(result).toEqual({ processed: 1, failed: 0, notificationsCreated: 0 });
      expect(messageBuilder.build).not.toHaveBeenCalled();
      expect(prisma.workflowEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ notificationProcessingStatus: 'PROCESSED' }),
        }),
      );
    });
  });
});
