import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ConversationRepository } from './conversation.repository';

/**
 * Sprint 33 — Consumer Conversation Experience Foundation
 * (docs/domains/d2c.md §"Idempotency and Repeated Messages" / "Tenant
 * Isolation"). Fakes just enough of `prisma.consumerConversation` to
 * exercise the real check-then-create logic — the exact
 * `ConsumerRepository.findOrCreate` pattern (Sprint 32) applied to
 * `[organisationId, channel, externalConversationId]` identity.
 */
describe('ConversationRepository — idempotency, concurrency, and tenant isolation', () => {
  const ORG_A = 'org-a';
  const ORG_B = 'org-b';

  function makeRepository() {
    const store: {
      id: string;
      organisationId: string;
      channel: string;
      externalConversationId: string;
      state: string;
      status: string;
      [key: string]: unknown;
    }[] = [];
    let nextId = 1;

    const prisma = {
      consumerConversation: {
        findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
          const match = store.find(
            (row) =>
              (where.id === undefined || row.id === where.id) &&
              row.organisationId === where.organisationId &&
              (where.channel === undefined || row.channel === where.channel) &&
              (where.externalConversationId === undefined ||
                row.externalConversationId === where.externalConversationId),
          );
          return Promise.resolve(match ? { ...match } : null);
        }),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          const collision = store.find(
            (row) =>
              row.organisationId === data.organisationId &&
              row.channel === data.channel &&
              row.externalConversationId === data.externalConversationId,
          );
          if (collision) {
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
              code: 'P2002',
              clientVersion: '5.22.0',
            });
          }
          const row = {
            id: `conversation-${nextId++}`,
            state: 'NEW',
            status: 'ACTIVE',
            ...data,
          } as (typeof store)[number];
          store.push(row);
          return Promise.resolve({ ...row });
        }),
        updateMany: jest.fn(
          ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            const row = store.find(
              (r) => r.id === where.id && r.organisationId === where.organisationId,
            );
            if (!row) return Promise.resolve({ count: 0 });
            // Real Prisma/Postgres translates the `Prisma.JsonNull` sentinel
            // into an actual SQL NULL — this fake mirrors that so `reset()`
            // behaves identically to the real repository.
            const normalized = {
              ...data,
              ...(data.context === Prisma.JsonNull ? { context: null } : {}),
            };
            Object.assign(row, normalized);
            return Promise.resolve({ count: 1 });
          },
        ),
        findUniqueOrThrow: jest.fn(({ where }: { where: { id: string } }) => {
          const row = store.find((r) => r.id === where.id);
          if (!row) throw new Error('not found');
          return Promise.resolve({ ...row });
        }),
      },
    } as unknown as PrismaService;

    return { repository: new ConversationRepository(prisma), store };
  }

  it('creates a new conversation on first contact', async () => {
    const { repository } = makeRepository();
    const result = await repository.findOrCreate(ORG_A, 'WHATSAPP', '+2348012340001');
    expect(result.created).toBe(true);
    expect(result.conversation.state).toBe('NEW');
  });

  it('a repeated message on the same external id returns the existing conversation, not a duplicate', async () => {
    const { repository } = makeRepository();
    const first = await repository.findOrCreate(ORG_A, 'WHATSAPP', '+2348012340001');
    const second = await repository.findOrCreate(ORG_A, 'WHATSAPP', '+2348012340001');
    expect(second.created).toBe(false);
    expect(second.conversation.id).toBe(first.conversation.id);
  });

  it('two concurrent first messages from the same external id converge on exactly one conversation (the P2002 race path)', async () => {
    const { repository, store } = makeRepository();
    const [a, b] = await Promise.all([
      repository.findOrCreate(ORG_A, 'WHATSAPP', '+2348012340002'),
      repository.findOrCreate(ORG_A, 'WHATSAPP', '+2348012340002'),
    ]);
    expect(store.filter((r) => r.organisationId === ORG_A).length).toBe(1);
    expect(a.conversation.id).toBe(b.conversation.id);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
  });

  it('tenant isolation: the same external conversation id in a different organisation is a separate conversation', async () => {
    const { repository } = makeRepository();
    const inOrgA = await repository.findOrCreate(ORG_A, 'WHATSAPP', '+2348012340003');
    const inOrgB = await repository.findOrCreate(ORG_B, 'WHATSAPP', '+2348012340003');
    expect(inOrgA.created).toBe(true);
    expect(inOrgB.created).toBe(true);
    expect(inOrgA.conversation.id).not.toBe(inOrgB.conversation.id);
  });

  it('tenant isolation: findById never resolves a conversation belonging to another organisation', async () => {
    const { repository } = makeRepository();
    const { conversation } = await repository.findOrCreate(ORG_A, 'WHATSAPP', '+2348012340004');
    const crossTenant = await repository.findById(ORG_B, conversation.id);
    expect(crossTenant).toBeNull();
  });

  it('tenant isolation: update cannot mutate a cross-tenant conversation', async () => {
    const { repository, store } = makeRepository();
    const { conversation } = await repository.findOrCreate(ORG_A, 'WHATSAPP', '+2348012340005');
    const result = await repository.update(ORG_B, conversation.id, { state: 'MAIN_MENU' });
    expect(result).toBeNull();
    expect(store.find((r) => r.id === conversation.id)?.state).toBe('NEW');
  });

  it('reset clears context and sets the given state', async () => {
    const { repository } = makeRepository();
    const { conversation } = await repository.findOrCreate(ORG_A, 'WHATSAPP', '+2348012340006');
    await repository.update(ORG_A, conversation.id, {
      context: { step: 'AWAITING_NAME' } as never,
    });
    const reset = await repository.reset(ORG_A, conversation.id, 'MAIN_MENU');
    expect(reset!.state).toBe('MAIN_MENU');
    expect(reset!.context).toBeNull();
  });
});
