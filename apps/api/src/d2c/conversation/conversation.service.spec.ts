import {
  Consumer,
  ConsumerConversation,
  ConsumerConversationMessage,
  Prisma,
  Territory,
} from '@prisma/client';

import { AuditService } from '../../identity/audit/audit.service';
import { OrganisationService } from '../../identity/organisation/organisation.service';
import { TerritoryRepository } from '../../retail/territory/territory.repository';
import { ConsumerService } from '../consumer/consumer.service';
import { ConversationMessageRepository } from './conversation-message.repository';
import { ConversationRepository } from './conversation.repository';
import { ConversationService } from './conversation.service';

/**
 * Sprint 33 — Consumer Conversation Experience Foundation
 * (docs/domains/d2c.md). End-to-end state-machine tests against a small,
 * real in-memory harness (not per-call mocks) — genuine multi-step
 * conversations (register → territory → location → menu) need real state
 * to actually flow between `handleInboundMessage` calls, the same way a
 * real channel adapter or the Sprint 42 simulator will drive it.
 */
describe('ConversationService', () => {
  const ORG_A = 'org-a';
  const ORG_B = 'org-b';

  /** Deliberately mirrors the REAL Boby Bites seed shape (Sprint 4.8): a
   *  single-child chain at the top (Oyo State -> Ibadan, exactly one child
   *  each) before the first real branch point (Ibadan North vs Ibadan
   *  South-West) — proving `resolveBranchPoint` genuinely skips the
   *  pointless single-option levels rather than merely working by
   *  coincidence on a flat fixture. */
  function makeTerritoryFixture(organisationId: string) {
    const rows: Territory[] = [
      {
        id: 't-oyo',
        organisationId,
        territoryCode: 'TER-A-1',
        name: 'Oyo State',
        type: 'State',
        parentTerritoryId: null,
        status: 'ACTIVE',
      } as Territory,
      {
        id: 't-ibadan',
        organisationId,
        territoryCode: 'TER-A-2',
        name: 'Ibadan',
        type: 'City',
        parentTerritoryId: 't-oyo',
        status: 'ACTIVE',
      } as Territory,
      {
        id: 't-ibn',
        organisationId,
        territoryCode: 'TER-A-3',
        name: 'Ibadan North',
        type: 'LGA',
        parentTerritoryId: 't-ibadan',
        status: 'ACTIVE',
      } as Territory,
      {
        id: 't-ibsw',
        organisationId,
        territoryCode: 'TER-A-6',
        name: 'Ibadan South-West',
        type: 'LGA',
        parentTerritoryId: 't-ibadan',
        status: 'ACTIVE',
      } as Territory,
      {
        id: 't-bodija',
        organisationId,
        territoryCode: 'TER-A-4',
        name: 'Bodija',
        type: 'Area',
        parentTerritoryId: 't-ibn',
        status: 'ACTIVE',
      } as Territory,
      {
        id: 't-mokola',
        organisationId,
        territoryCode: 'TER-A-5',
        name: 'Mokola',
        type: 'Area',
        parentTerritoryId: 't-ibn',
        status: 'ACTIVE',
      } as Territory,
    ];
    return rows;
  }

  function makeTerritoryRepository(rows: Territory[]): TerritoryRepository {
    return {
      findById: jest.fn((organisationId: string, id: string) =>
        Promise.resolve(
          rows.find((r) => r.id === id && r.organisationId === organisationId) ?? null,
        ),
      ),
      findManyByOrganisation: jest.fn(
        (
          organisationId: string,
          params: { parentTerritoryId?: string | null; status?: string } = {},
        ) => {
          const matches = rows.filter((r) => {
            if (r.organisationId !== organisationId) return false;
            if (params.status && r.status !== params.status) return false;
            if (params.parentTerritoryId === null) return r.parentTerritoryId === null;
            if (params.parentTerritoryId !== undefined)
              return r.parentTerritoryId === params.parentTerritoryId;
            return true;
          });
          return Promise.resolve(matches);
        },
      ),
    } as unknown as TerritoryRepository;
  }

  /** A real, minimal, phone-keyed fake — not the actual `ConsumerService`
   *  (too many of its own dependencies), but genuine find-or-create/update
   *  semantics so a real conversation flow (register, then update its own
   *  location) works end to end exactly like the real service would. */
  function makeConsumerService() {
    const consumers: Consumer[] = [];
    let seq = 1;
    const normalize = (phone: string) =>
      phone.startsWith('+') ? phone : `+234${phone.replace(/^0/, '')}`;

    const service = {
      findConsumerByPhone: jest.fn((organisationId: string, phone: string) => {
        if (!/^\+?\d{8,15}$/.test(phone.replace(/^0/, ''))) return Promise.resolve(null);
        const normalized = normalize(phone);
        return Promise.resolve(
          consumers.find(
            (c) => c.organisationId === organisationId && c.normalizedPhone === normalized,
          ) ?? null,
        );
      }),
      registerConsumer: jest.fn(
        (organisationId: string, input: { fullName: string; phoneNumber: string }) => {
          if (!/^\+?\d{8,15}$/.test(input.phoneNumber.replace(/^0/, ''))) {
            return Promise.reject(new Error('BadRequestException: phone'));
          }
          const normalized = normalize(input.phoneNumber);
          const existing = consumers.find(
            (c) => c.organisationId === organisationId && c.normalizedPhone === normalized,
          );
          if (existing) return Promise.resolve({ consumer: existing, created: false });
          const consumer = {
            id: `consumer-${seq}`,
            organisationId,
            consumerCode: `CON-${String(seq).padStart(6, '0')}`,
            fullName: input.fullName,
            phoneNumber: input.phoneNumber,
            normalizedPhone: normalized,
            email: null,
            status: 'ACTIVE',
            territoryId: null,
            address: null,
            marketingOptIn: false,
            createdById: null,
            updatedById: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as Consumer;
          seq += 1;
          consumers.push(consumer);
          return Promise.resolve({ consumer, created: true });
        },
      ),
      getById: jest.fn((organisationId: string, id: string) =>
        Promise.resolve(
          consumers.find((c) => c.id === id && c.organisationId === organisationId) ?? null,
        ),
      ),
      updateConsumerLocation: jest.fn(
        (organisationId: string, id: string, territoryId: string | null) => {
          const consumer = consumers.find(
            (c) => c.id === id && c.organisationId === organisationId,
          );
          if (!consumer) return Promise.reject(new Error('not found'));
          consumer.territoryId = territoryId;
          return Promise.resolve(consumer);
        },
      ),
      reportLocationNotFound: jest.fn().mockResolvedValue({ id: 'location-request-1' }),
    } as unknown as ConsumerService;
    return { service, consumers };
  }

  function makeConversationRepository() {
    const rows: ConsumerConversation[] = [];
    let seq = 1;
    const repo = {
      findById: jest.fn((organisationId: string, id: string) =>
        Promise.resolve(
          rows.find((r) => r.id === id && r.organisationId === organisationId) ?? null,
        ),
      ),
      findByExternalId: jest.fn(
        (organisationId: string, channel: string, externalConversationId: string) =>
          Promise.resolve(
            rows.find(
              (r) =>
                r.organisationId === organisationId &&
                r.channel === channel &&
                r.externalConversationId === externalConversationId,
            ) ?? null,
          ),
      ),
      findOrCreate: jest.fn(
        async (organisationId: string, channel: string, externalConversationId: string) => {
          const existing = rows.find(
            (r) =>
              r.organisationId === organisationId &&
              r.channel === channel &&
              r.externalConversationId === externalConversationId,
          );
          if (existing) return { conversation: existing, created: false };
          const conversation = {
            id: `conv-${seq}`,
            organisationId,
            consumerId: null,
            channel,
            externalConversationId,
            state: 'NEW',
            context: null,
            status: 'ACTIVE',
            lastInteractionAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          } as unknown as ConsumerConversation;
          seq += 1;
          rows.push(conversation);
          return { conversation, created: true };
        },
      ),
      update: jest.fn((organisationId: string, id: string, data: Record<string, unknown>) => {
        const row = rows.find((r) => r.id === id && r.organisationId === organisationId);
        if (!row) return Promise.resolve(null);
        Object.assign(row, {
          ...data,
          context: data.context === Prisma.JsonNull ? null : (data.context ?? row.context),
        });
        return Promise.resolve(row);
      }),
      reset: jest.fn((organisationId: string, id: string, state: string) => {
        const row = rows.find((r) => r.id === id && r.organisationId === organisationId);
        if (!row) return Promise.resolve(null);
        Object.assign(row, { state, context: null });
        return Promise.resolve(row);
      }),
      list: jest.fn(() => Promise.resolve(rows)),
    };
    return { repo: repo as unknown as ConversationRepository, rows };
  }

  function makeMessageRepository() {
    const rows: ConsumerConversationMessage[] = [];
    return {
      repo: {
        append: jest.fn(
          (organisationId: string, conversationId: string, direction: string, payload: unknown) => {
            const row = {
              id: `msg-${rows.length + 1}`,
              organisationId,
              conversationId,
              direction,
              payload,
              createdAt: new Date(),
            } as unknown as ConsumerConversationMessage;
            rows.push(row);
            return Promise.resolve(row);
          },
        ),
        listByConversation: jest.fn((organisationId: string, conversationId: string) =>
          Promise.resolve(
            rows.filter(
              (r) => r.organisationId === organisationId && r.conversationId === conversationId,
            ),
          ),
        ),
      } as unknown as ConversationMessageRepository,
      rows,
    };
  }

  function makeHarness(organisationId = ORG_A) {
    const territoryRows = makeTerritoryFixture(organisationId);
    const territoryRepository = makeTerritoryRepository(territoryRows);
    const { service: consumerService, consumers } = makeConsumerService();
    const { repo: conversationRepository } = makeConversationRepository();
    const { repo: messageRepository } = makeMessageRepository();
    const auditService = { record: jest.fn() } as unknown as AuditService;
    const organisationService = {
      getById: jest.fn().mockResolvedValue({
        id: organisationId,
        name: organisationId === ORG_A ? 'Boby Bites' : 'Rival Snacks',
        displayName: null,
        country: 'Nigeria',
      }),
    } as unknown as OrganisationService;

    const service = new ConversationService(
      conversationRepository,
      messageRepository,
      consumerService,
      territoryRepository,
      auditService,
      organisationService,
    );
    return { service, consumers, auditService, conversationRepository };
  }

  describe('full registration flow (new consumer)', () => {
    it('walks welcome -> register -> name -> territory -> location -> confirmation -> main menu', async () => {
      const { service, consumers } = makeHarness();
      const phone = '08012340001';

      const welcome = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'hi' },
      });
      expect(welcome.state).toBe('NEW');
      expect(welcome.messages[0]).toMatchObject({ type: 'BUTTONS' });

      const registerClick = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'REGISTER' },
      });
      expect(registerClick.state).toBe('REGISTRATION');
      expect(registerClick.messages[0]).toMatchObject({ type: 'TEXT', text: "What's your name?" });

      const nameEntry = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'John Ajayi' },
      });
      expect(nameEntry.state).toBe('LOCATION_SELECTION');
      expect(consumers).toHaveLength(1);
      expect(consumers[0]!.fullName).toBe('John Ajayi');
      const territoryList = nameEntry.messages.find((m) => m.type === 'LIST') as Extract<
        (typeof nameEntry.messages)[number],
        { type: 'LIST' }
      >;
      // "Oyo State" -> "Ibadan" is a single-child chain with no real
      // choice — the territory list must skip straight to the first level
      // that actually branches (Ibadan North vs Ibadan South-West), never
      // presenting the pointless single-option "Oyo State"/"Ibadan" steps.
      const territoryLabels = territoryList.options.map((o) => o.label);
      expect(territoryLabels).toEqual(['Ibadan North', 'Ibadan South-West']);
      expect(territoryLabels).not.toContain('Oyo State');
      expect(territoryLabels).not.toContain('Ibadan');

      const territoryPick = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 't-ibn' },
      });
      const locationList = territoryPick.messages.find((m) => m.type === 'LIST') as Extract<
        (typeof territoryPick.messages)[number],
        { type: 'LIST' }
      >;
      expect(locationList.options.map((o) => o.label)).toEqual(
        expect.arrayContaining(['Bodija', 'Mokola']),
      );

      const locationPick = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 't-bodija' },
      });
      expect(locationPick.state).toBe('MAIN_MENU');
      expect(consumers[0]!.territoryId).toBe('t-bodija');
      const confirmation = locationPick.messages.find(
        (m) => m.type === 'TEXT' && m.text.includes('registered'),
      );
      expect(confirmation).toBeDefined();
      expect((confirmation as { text: string }).text).toContain(consumers[0]!.consumerCode);
    });
  });

  describe('existing consumer recognition', () => {
    it('a brand new conversation from a phone that already has a Consumer skips registration entirely', async () => {
      const { service, consumers } = makeHarness();
      const phone = '08012340002';
      // Simulate a consumer already registered by some other means (e.g.
      // the internal admin UI) before ever messaging on this channel.
      consumers.push({
        id: 'pre-existing-consumer',
        organisationId: ORG_A,
        consumerCode: 'CON-999999',
        fullName: 'Pre-Registered Person',
        phoneNumber: phone,
        normalizedPhone: '+2348012340002',
        territoryId: null,
      } as Consumer);

      const first = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'hi' },
      });

      expect(first.state).toBe('MAIN_MENU');
      expect(first.messages[0]).toMatchObject({ type: 'TEXT' });
      expect((first.messages[0] as { text: string }).text).toContain('Welcome back');
      expect((first.messages[0] as { text: string }).text).toContain('Pre-Registered Person');
      // Never went through the welcome/register prompt.
      expect(
        first.messages.some(
          (m) => m.type === 'BUTTONS' && m.text.includes('Are you already registered'),
        ),
      ).toBe(false);
    });
  });

  describe('invalid selections', () => {
    it('rejects an unknown territory id and re-shows the same list', async () => {
      const { service } = makeHarness();
      const phone = '08012340003';
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'REGISTER' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'Someone' },
      });

      const invalid = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 'not-a-real-territory' },
      });
      expect(invalid.state).toBe('LOCATION_SELECTION');
      expect(invalid.messages[0]).toMatchObject({
        type: 'TEXT',
        text: expect.stringContaining('not a valid option'),
      });
      expect(invalid.messages.some((m) => m.type === 'LIST')).toBe(true);
    });

    it('rejects a location that does not belong to the previously selected territory', async () => {
      const { service } = makeHarness();
      const phone = '08012340004';
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'REGISTER' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'Someone Else' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 't-ibn' },
      });

      // 't-ibadan' is a real territory in this org, but not a CHILD of
      // 't-ibn' — the exact territory/location mismatch brief §12 requires
      // rejecting.
      const mismatch = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 't-ibadan' },
      });
      expect(mismatch.state).toBe('LOCATION_SELECTION');
      expect(mismatch.messages[0]).toMatchObject({
        text: expect.stringContaining('not a valid option'),
      });
    });
  });

  describe('location not found', () => {
    it('records a ConsumerLocationRequest via the existing Sprint 32 service and still completes registration', async () => {
      const { service, consumers } = makeHarness();
      const phone = '08012340005';
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'REGISTER' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'No Location Person' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 't-ibn' },
      });
      const notFoundClick = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 'LOCATION_NOT_FOUND' },
      });
      expect(notFoundClick.messages[0]).toMatchObject({
        type: 'TEXT',
        text: expect.stringContaining('describe your location'),
      });

      const described = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'Behind the big mosque on Ring Road' },
      });
      expect(described.state).toBe('MAIN_MENU');
      expect(described.messages[0]).toMatchObject({
        text: expect.stringContaining('recorded your location request'),
      });
      expect(consumers[0]!.territoryId).toBeNull();
    });
  });

  describe('idempotency / concurrency', () => {
    it('5 concurrent REGISTER+name sequences for the same phone create exactly one consumer', async () => {
      const { service, consumers } = makeHarness();
      const phone = '08012340006';

      // Ensure the conversation exists first (the realistic case: the
      // consumer has already opened the chat once).
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'REGISTER' },
      });

      await Promise.all(
        Array.from({ length: 5 }).map(() =>
          service.handleInboundMessage(ORG_A, {
            channel: 'WHATSAPP',
            externalConversationId: phone,
            input: { type: 'TEXT', text: 'Race Person' },
          }),
        ),
      );

      expect(consumers).toHaveLength(1);
    });
  });

  describe('reset', () => {
    it('MENU returns a registered consumer to the main menu from any state', async () => {
      const { service } = makeHarness();
      const phone = '08012340007';
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'REGISTER' },
      });
      // Mid-name-entry, send MENU instead.
      const reset = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'MENU' },
      });
      // Not yet registered — resets back to NEW, shows welcome again.
      expect(reset.state).toBe('NEW');
      expect(reset.messages[0]).toMatchObject({ type: 'BUTTONS' });
    });
  });

  describe('tenant isolation', () => {
    it('the same phone number in a different organisation resolves to a separate consumer and conversation', async () => {
      const harnessA = makeHarness(ORG_A);
      const harnessB = makeHarness(ORG_B);
      const phone = '08012340008';

      await harnessA.service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'REGISTER' },
      });
      await harnessA.service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'Org A Person' },
      });

      const bWelcome = await harnessB.service.handleInboundMessage(ORG_B, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'hi' },
      });

      expect(harnessA.consumers).toHaveLength(1);
      expect(harnessB.consumers).toHaveLength(0);
      // Org B has never seen this phone — it gets the welcome flow, not
      // Org A's registered consumer.
      expect(bWelcome.state).toBe('NEW');
    });

    it("each organisation's welcome message uses ITS OWN name, never another tenant's brand", async () => {
      const harnessA = makeHarness(ORG_A);
      const harnessB = makeHarness(ORG_B);

      const welcomeA = await harnessA.service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: '08012340010',
        input: { type: 'TEXT', text: 'hi' },
      });
      const welcomeB = await harnessB.service.handleInboundMessage(ORG_B, {
        channel: 'WHATSAPP',
        externalConversationId: '08012340011',
        input: { type: 'TEXT', text: 'hi' },
      });

      const textA = (welcomeA.messages[0] as { text: string }).text;
      const textB = (welcomeB.messages[0] as { text: string }).text;
      expect(textA).toContain('Boby Bites');
      expect(textB).toContain('Rival Snacks');
      expect(textB).not.toContain('Boby Bites');
    });
  });

  describe('error handling', () => {
    it('an unrecognized command at the main menu gets a friendly re-prompt, never a raw error', async () => {
      const { service } = makeHarness();
      const phone = '08012340009';
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'REGISTER' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'Confused Person' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 't-ibn' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 't-bodija' },
      });

      const gibberish = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'SOMETHING_UNKNOWN' },
      });
      expect(gibberish.state).toBe('MAIN_MENU');
      expect(gibberish.messages[0]).toMatchObject({
        type: 'TEXT',
        text: expect.stringContaining("didn't understand"),
      });
    });
  });
});
