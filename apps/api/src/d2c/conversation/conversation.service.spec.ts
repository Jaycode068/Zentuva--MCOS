import {
  Consumer,
  ConsumerConversation,
  ConsumerConversationMessage,
  Prisma,
  Product,
  Territory,
} from '@prisma/client';

import { ConfigService } from '@nestjs/config';

import { ProductRepository } from '../../catalogue/product/product.repository';
import { PaymentService } from '../../finance/payment.service';
import { PaymentRepository, PaymentWithRelations } from '../../finance/payment.repository';
import { AuditService } from '../../identity/audit/audit.service';
import { OrganisationService } from '../../identity/organisation/organisation.service';
import {
  CreateProviderPaymentRequest,
  CreateProviderPaymentResult,
  PaymentProvider,
} from '../../payments/ports/payment-provider.port';
import { TerritoryRepository } from '../../retail/territory/territory.repository';
import { CustomerRepository } from '../../retail/customer/customer.repository';
import { OutletRepository } from '../../retail/outlet/outlet.repository';
import { SalesOrderRepository, SalesOrderWithRelations } from '../../sales/sales-order.repository';
import { SalesOrderService } from '../../sales/sales-order.service';
import { ConsumerService } from '../consumer/consumer.service';
import {
  DEFAULT_CAPABILITY_ENABLED,
  DEFAULT_CAPABILITY_LABELS,
  DEFAULT_CAPABILITY_ORDER,
  DEFAULT_MESSAGES,
} from '../conversation-config/d2c-conversation-config.types';
import { D2CConversationConfigService } from '../conversation-config/d2c-conversation-config.service';
import { CollectionPointFulfillmentRepository } from '../fulfillment/collection-point-fulfillment.repository';
import { D2COrderingService } from '../ordering/d2c-ordering.service';
import { LoyaltyService } from '../../promotions/loyalty/loyalty.service';
import { PromotionEvaluationService } from '../../promotions/reward/promotion-evaluation.service';
import { CollectionPointFulfillmentService } from '../fulfillment/collection-point-fulfillment.service';
import { D2CPaymentService } from '../payment/d2c-payment.service';
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

  /** A small in-memory `Product` catalogue — one D2C-orderable finished product
   *  ("Plantain Chips", ₦500) and one deliberately NOT orderable (no `sellingPrice`,
   *  exactly a real un-priced product) per organisation, tenant-scoped like every other
   *  fixture in this file. */
  function makeProductFixture(organisationId: string): Product[] {
    const suffix = organisationId === ORG_A ? 'a' : 'b';
    return [
      {
        id: `product-chips-${suffix}`,
        organisationId,
        code: `PRD-${suffix}-1`,
        name: 'Plantain Chips',
        displayName: null,
        slug: 'plantain-chips',
        category: 'SNACKS',
        type: 'FINISHED_PRODUCT',
        shortDescription: null,
        longDescription: null,
        unit: 'Pack',
        imageUrl: null,
        imageKey: null,
        status: 'ACTIVE',
        sellingPrice: 500,
        createdById: null,
        updatedById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        productVariantId: null,
      } as Product,
      {
        id: `product-unpriced-${suffix}`,
        organisationId,
        code: `PRD-${suffix}-2`,
        name: 'Unpriced Sample',
        displayName: null,
        slug: 'unpriced-sample',
        category: 'SNACKS',
        type: 'FINISHED_PRODUCT',
        shortDescription: null,
        longDescription: null,
        unit: 'Pack',
        imageUrl: null,
        imageKey: null,
        status: 'ACTIVE',
        sellingPrice: null,
        createdById: null,
        updatedById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        productVariantId: null,
      } as Product,
    ];
  }

  function makeProductRepository(rows: Product[]): ProductRepository {
    return {
      findById: jest.fn((organisationId: string, id: string) =>
        Promise.resolve(
          rows.find((p) => p.id === id && p.organisationId === organisationId) ?? null,
        ),
      ),
      findManyByOrganisationWithHierarchy: jest.fn(
        (organisationId: string, params?: { status?: string }) =>
          Promise.resolve(
            rows
              .filter(
                (p) =>
                  p.organisationId === organisationId &&
                  (!params?.status || p.status === params.status),
              )
              .map((p) => ({ ...p, productVariant: null })),
          ),
      ),
    } as unknown as ProductRepository;
  }

  /** A real `SalesOrderService` wired over small in-memory `SalesOrderRepository`/
   *  `CustomerRepository`/`OutletRepository` fakes — the SAME "real service, fake
   *  repository" philosophy `direct-sales-independence.spec.ts` already established, so
   *  `createForConsumer`'s actual idempotency/pricing/P2002-recovery logic runs for
   *  real, not a stub of it. `orders` is exposed so tests can assert on what was
   *  actually persisted. */
  function makeSalesOrderService(productRows: Product[]) {
    const orders: SalesOrderWithRelations[] = [];
    let seq = 0;

    const customerRepository = {
      findById: jest.fn().mockResolvedValue(null),
    } as unknown as CustomerRepository;
    const outletRepository = {
      findById: jest.fn().mockResolvedValue(null),
    } as unknown as OutletRepository;
    const productRepository = makeProductRepository(productRows);

    const salesOrderRepository = {
      existsByCode: jest.fn().mockResolvedValue(false),
      findByIdempotencyKey: jest.fn((organisationId: string, idempotencyKey: string) =>
        Promise.resolve(
          orders.find(
            (o) => o.organisationId === organisationId && o.idempotencyKey === idempotencyKey,
          ) ?? null,
        ),
      ),
      create: jest.fn((data: Record<string, unknown>) => {
        const idempotencyKey = data.idempotencyKey as string | undefined;
        const organisationId = (data.organisation as { connect: { id: string } }).connect.id;
        if (
          idempotencyKey &&
          orders.some(
            (o) => o.organisationId === organisationId && o.idempotencyKey === idempotencyKey,
          )
        ) {
          // Simulates the real `@@unique([organisationId, idempotencyKey])` P2002 race.
          const error = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
          Object.setPrototypeOf(error, Prisma.PrismaClientKnownRequestError.prototype);
          return Promise.reject(error);
        }
        seq += 1;
        const consumerId =
          (data.consumer as { connect: { id: string } } | undefined)?.connect.id ?? null;
        const items = (
          data.items as {
            create: { productId: string; quantity: number; unitPrice: number; lineTotal: number }[];
          }
        ).create.map((item, index) => ({
          id: `item-${seq}-${index}`,
          ...item,
          quantityFulfilled: 0,
          product: productRows.find((p) => p.id === item.productId)!,
        }));
        const order = {
          id: `order-${seq}`,
          organisationId,
          orderCode: `SO-00000${seq}`,
          customerId: null,
          outletId: null,
          consumerId,
          salesAgentId: null,
          source: data.source,
          status: data.status,
          orderDate: data.orderDate,
          notes: null,
          subtotal: data.subtotal,
          discount: data.discount,
          total: data.total,
          idempotencyKey: idempotencyKey ?? null,
          createdById: null,
          updatedById: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          customer: null,
          outlet: null,
          consumer: consumerId ? { id: consumerId, consumerCode: '', fullName: '' } : null,
          items,
        } as unknown as SalesOrderWithRelations;
        orders.push(order);
        return Promise.resolve(order);
      }),
      findById: jest.fn((organisationId: string, id: string) =>
        Promise.resolve(
          orders.find((o) => o.id === id && o.organisationId === organisationId) ?? null,
        ),
      ),
      // Sprint 41 — `D2COrderingService.listConsumerOrders`'s "My Orders" read.
      findManyPaginated: jest.fn(
        (
          organisationId: string,
          params: { consumerId?: string; page: number; pageSize: number },
        ) => {
          const matching = orders
            .filter(
              (o) =>
                o.organisationId === organisationId &&
                (!params.consumerId || o.consumerId === params.consumerId),
            )
            .slice()
            .reverse(); // newest-first, mirroring the real repository's `createdAt: 'desc'`.
          const start = (params.page - 1) * params.pageSize;
          return Promise.resolve({
            items: matching.slice(start, start + params.pageSize),
            total: matching.length,
          });
        },
      ),
    } as unknown as SalesOrderRepository;

    const service = new SalesOrderService(
      salesOrderRepository,
      customerRepository,
      outletRepository,
      productRepository,
    );
    return { service, orders, productRepository };
  }

  /** A small in-memory `PaymentRepository`-shaped fake covering only the four
   *  Sprint 35 D2C methods `PaymentService` delegates to — mirrors the exact
   *  find-then-create-then-P2002-recover semantics of the real repository,
   *  so `D2CPaymentService`'s own idempotency logic runs for real. */
  function makePaymentRepositoryFake() {
    const rows: PaymentWithRelations[] = [];
    let seq = 0;

    const findByMerchantReference = (merchantReference: string) =>
      Promise.resolve(rows.find((p) => p.merchantReference === merchantReference) ?? null);

    return {
      repo: {
        findByMerchantReference,
        createPendingForConsumer: jest.fn(
          async (data: {
            organisationId: string;
            consumerId: string;
            salesOrderId: string;
            amount: number;
            currency: string;
            merchantReference: string;
          }) => {
            const existing = await findByMerchantReference(data.merchantReference);
            if (existing) return { payment: existing, wasCreated: false };
            seq += 1;
            const payment = {
              id: `payment-${seq}`,
              organisationId: data.organisationId,
              customerId: null,
              consumerId: data.consumerId,
              salesOrderId: data.salesOrderId,
              paymentDate: new Date(),
              amount: data.amount,
              currency: data.currency,
              method: 'ONLINE',
              reference: null,
              notes: null,
              status: 'PENDING',
              cashAccountId: null,
              idempotencyKey: null,
              provider: 'OPAY',
              providerReference: null,
              merchantReference: data.merchantReference,
              checkoutUrl: null,
              createdById: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              customer: null,
              consumer: null,
              allocations: [],
            } as unknown as PaymentWithRelations;
            rows.push(payment);
            return { payment, wasCreated: true };
          },
        ),
        attachProviderDetails: jest.fn(
          async (organisationId: string, id: string, details: Record<string, unknown>) => {
            const row = rows.find((p) => p.id === id && p.organisationId === organisationId);
            if (!row) return null;
            Object.assign(row, details);
            return row;
          },
        ),
        applyProviderCallback: jest.fn(
          async (
            organisationId: string,
            id: string,
            toStatus: string,
            providerReference: string,
          ) => {
            const row = rows.find((p) => p.id === id && p.organisationId === organisationId);
            if (!row) return null;
            if (row.status !== 'PENDING') {
              return { payment: row, wasApplied: false };
            }
            (row as unknown as { status: string }).status = toStatus;
            (row as unknown as { providerReference: string }).providerReference = providerReference;
            return { payment: row, wasApplied: true };
          },
        ),
      } as unknown as PaymentRepository,
      rows,
    };
  }

  /** A controllable fake `PaymentProvider` — always returns a successful
   *  `CREATED` cashier response unless the test overrides `createPayment`. */
  function makeFakePaymentProvider(): jest.Mocked<PaymentProvider> {
    return {
      name: 'opay',
      createPayment: jest.fn(
        async (request: CreateProviderPaymentRequest): Promise<CreateProviderPaymentResult> => ({
          outcome: 'CREATED',
          checkoutUrl: `https://sandbox.opaycheckout.com/pay/${request.reference}`,
          providerReference: `OPAY-${request.reference}`,
        }),
      ),
      verifyCallback: jest.fn(),
    } as unknown as jest.Mocked<PaymentProvider>;
  }

  function makeHarness(organisationId = ORG_A, productRowsOverride?: Product[]) {
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
        currency: 'NGN',
      }),
    } as unknown as OrganisationService;

    const productRows = productRowsOverride ?? makeProductFixture(organisationId);
    const { service: salesOrderService, orders } = makeSalesOrderService(productRows);
    const collectionPointFulfillmentRepository = {
      findManyBySalesOrderIds: jest.fn().mockResolvedValue([]),
      findBySalesOrderId: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<CollectionPointFulfillmentRepository>;
    const d2cOrderingService = new D2COrderingService(
      makeProductRepository(productRows),
      consumerService,
      organisationService,
      salesOrderService,
      collectionPointFulfillmentRepository,
    );

    const { repo: paymentRepository, rows: payments } = makePaymentRepositoryFake();
    const paymentService = new PaymentService(paymentRepository, {} as never);
    const paymentProvider = makeFakePaymentProvider();
    const config = {
      get: jest.fn((key: string) =>
        key === 'webBaseUrl'
          ? 'http://localhost:3000'
          : 'http://localhost:4000/api/payments/opay/webhook',
      ),
    } as unknown as ConfigService;
    const collectionPointFulfillmentService = {
      autoAssign: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CollectionPointFulfillmentService>;
    const promotionEvaluationService = {
      evaluateOrderQualification: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<PromotionEvaluationService>;
    const d2cPaymentService = new D2CPaymentService(
      paymentProvider,
      paymentService,
      salesOrderService,
      consumerService,
      organisationService,
      auditService,
      config,
      collectionPointFulfillmentService,
      promotionEvaluationService,
    );

    const loyaltyService = {
      getAccount: jest.fn().mockResolvedValue(null),
      listLedger: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    } as unknown as jest.Mocked<LoyaltyService>;

    // Sprint 44 — a fake resolver returning EXACTLY the platform defaults (the same
    // `DEFAULT_MESSAGES`/`DEFAULT_CAPABILITY_*` constants the real
    // `D2CConversationConfigService` falls back to for an unconfigured tenant), so every
    // pre-existing test below keeps exercising byte-identical wording/menu behaviour —
    // this harness never exercises tenant CUSTOMIZATION itself (see the dedicated
    // "Sprint 44 — tenant conversation configuration" describe block for that).
    const configService = {
      resolveEffectiveConfig: jest.fn(async (organisationId: string) => {
        const organisation = await organisationService.getById(organisationId);
        return {
          organisationId,
          businessName: organisation?.displayName ?? organisation?.name ?? 'us',
          supportPhone: organisation?.phone ?? null,
          supportEmail: organisation?.supportEmail ?? null,
          capabilities: DEFAULT_CAPABILITY_ORDER.map((capability, index) => ({
            capability,
            enabled: DEFAULT_CAPABILITY_ENABLED[capability],
            displayLabel: DEFAULT_CAPABILITY_LABELS[capability],
            sortOrder: index,
          })),
          messages: { ...DEFAULT_MESSAGES },
        };
      }),
    } as unknown as jest.Mocked<D2CConversationConfigService>;

    const service = new ConversationService(
      conversationRepository,
      messageRepository,
      consumerService,
      territoryRepository,
      auditService,
      d2cOrderingService,
      d2cPaymentService,
      loyaltyService,
      configService,
    );
    return {
      service,
      consumers,
      auditService,
      conversationRepository,
      orders,
      productRows,
      payments,
      paymentProvider,
      loyaltyService,
      collectionPointFulfillmentRepository,
      configService,
    };
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

  describe('Order Snacks flow (Sprint 34)', () => {
    /** Registers a fresh consumer and drives them all the way to `MAIN_MENU` — the
     *  common starting point every ordering test below needs, reusing the exact
     *  registration flow already verified by name above rather than reimplementing it. */
    async function registerToMainMenu(service: ConversationService, phone: string) {
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'REGISTER' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'Order Test Consumer' },
      });
      // No territory hierarchy needed for these tests — skip past it if presented by
      // choosing the first real branch, mirroring the registration test's own shape.
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 't-ibn' },
      });
      return service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 't-bodija' },
      });
    }

    it('walks Order Snacks -> browse -> select -> quantity -> checkout -> confirm -> SalesOrder created', async () => {
      const { service, consumers, orders } = makeHarness();
      const phone = '08099900001';
      await registerToMainMenu(service, phone);

      const menu = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'ORDER_SNACKS' },
      });
      expect(menu.state).toBe('ACTIVE');
      const productList = menu.messages.find((m) => m.type === 'LIST') as Extract<
        (typeof menu.messages)[number],
        { type: 'LIST' }
      >;
      expect(productList.options.map((o) => o.label)).toEqual(
        expect.arrayContaining([expect.stringContaining('Plantain Chips')]),
      );
      // The unpriced product must never be offered (brief §3/§5 — availability).
      expect(productList.options.map((o) => o.label).join(' ')).not.toContain('Unpriced');

      const selectProduct = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 'product-chips-a' },
      });
      // Sprint 41 — a product recap (name + price) now precedes the quantity prompt
      // (brief §5/§18), channel-neutral via the new `imageUrl`-less TEXT variant.
      expect(selectProduct.messages[0]).toMatchObject({
        type: 'TEXT',
        text: expect.stringContaining('Plantain Chips'),
      });
      expect(selectProduct.messages[1]).toMatchObject({
        type: 'TEXT',
        text: 'How many would you like?',
      });

      const enterQuantity = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: '2' },
      });
      const cartText = enterQuantity.messages.find(
        (m) => m.type === 'TEXT' && m.text.includes('Your Order'),
      ) as { text: string };
      expect(cartText.text).toContain('Plantain Chips x 2');
      expect(cartText.text).toContain('1000'); // 500 * 2

      const checkout = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'CHECKOUT' },
      });
      expect(
        checkout.messages.some((m) => m.type === 'BUTTONS' && m.text === 'Confirm order?'),
      ).toBe(true);

      const confirm = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'CONFIRM_ORDER' },
      });
      // Sprint 35 — order confirmation now stops at "awaiting payment,"
      // never MAIN_MENU, until a payment actually succeeds.
      expect(confirm.state).toBe('ACTIVE');
      const confirmationText = confirm.messages.find(
        (m) => m.type === 'TEXT' && m.text.includes('Order created successfully'),
      ) as { text: string };
      expect(confirmationText.text).toContain('SO-000001');
      expect(confirmationText.text).toContain('Awaiting Payment');
      expect(confirm.messages.some((m) => m.type === 'BUTTONS' && m.text === 'Ready to pay?')).toBe(
        true,
      );

      expect(orders).toHaveLength(1);
      expect(orders[0]!.source).toBe('D2C');
      expect(orders[0]!.consumerId).toBe(consumers[0]!.id);
      expect(orders[0]!.customerId).toBeNull();
      expect(orders[0]!.total).toBe(1000);
      expect(orders[0]!.items).toHaveLength(1);
      expect(orders[0]!.items[0]!.quantity).toBe(2);
      expect(orders[0]!.items[0]!.unitPrice).toBe(500);

      // Sprint 35 — "Pay Now" creates a real D2C Payment and returns OPay's
      // (fake, in this test) checkoutUrl via a PAYMENT_REQUIRED message.
      const payNow = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'PAY_NOW' },
      });
      expect(payNow.state).toBe('ACTIVE');
      const paymentRequired = payNow.messages.find((m) => m.type === 'PAYMENT_REQUIRED') as Extract<
        (typeof payNow.messages)[number],
        { type: 'PAYMENT_REQUIRED' }
      >;
      expect(paymentRequired).toBeDefined();
      expect(paymentRequired.orderReference).toBe('SO-000001');
      expect(paymentRequired.amount).toBe(1000);
      expect(paymentRequired.currency).toBe('NGN');
      expect(paymentRequired.checkoutUrl).toContain('PAY-SO-000001');
    });

    it('rejects an invalid quantity and re-prompts without corrupting the cart', async () => {
      const { service } = makeHarness();
      const phone = '08099900002';
      await registerToMainMenu(service, phone);
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'ORDER_SNACKS' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 'product-chips-a' },
      });

      const badQuantity = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'not-a-number' },
      });
      expect(badQuantity.messages[0]).toMatchObject({
        type: 'TEXT',
        text: 'Please enter a valid quantity.',
      });

      const zeroQuantity = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: '0' },
      });
      expect(zeroQuantity.messages[0]).toMatchObject({
        type: 'TEXT',
        text: 'Please enter a valid quantity.',
      });

      const goodQuantity = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: '1' },
      });
      expect(
        goodQuantity.messages.some((m) => m.type === 'TEXT' && m.text === 'Added to your cart.'),
      ).toBe(true);
    });

    it('rejects an unpriced/unavailable product and an unknown SKU id immediately at selection time', async () => {
      // Sprint 41 — `handleBrowsing` now re-derives the selected product from the
      // EXISTING orderable-products read (needed to show the product recap/price/image,
      // brief §5/§18) BEFORE advancing to AWAITING_QUANTITY, so an unpriced/unavailable
      // or genuinely unknown SKU is rejected immediately, re-presenting the list — one
      // step earlier than the previous behavior (which let it reach quantity entry
      // before `addItemToCart`'s own defense-in-depth check caught it there instead).
      const { service } = makeHarness();
      const phone = '08099900003';
      await registerToMainMenu(service, phone);
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'ORDER_SNACKS' },
      });

      // The unpriced product exists but is not D2C-orderable.
      const rejectedUnpriced = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 'product-unpriced-a' },
      });
      expect(rejectedUnpriced.messages[0]).toMatchObject({
        type: 'TEXT',
        text: "That's not a valid option. Please choose one from the list.",
      });
      expect(rejectedUnpriced.messages.some((m) => m.type === 'LIST')).toBe(true);

      // A genuinely unknown SKU id gets the exact same rejection.
      const rejectedUnknown = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 'no-such-product-id' },
      });
      expect(rejectedUnknown.messages[0]).toMatchObject({
        type: 'TEXT',
        text: "That's not a valid option. Please choose one from the list.",
      });
    });

    it('supports multiple products on one order (one SalesOrder, multiple SalesOrderItems)', async () => {
      const { service, orders } = makeHarness();
      const phone = '08099900004';
      await registerToMainMenu(service, phone);
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'ORDER_SNACKS' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 'product-chips-a' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: '1' },
      });
      // "Add Another Item" then add the SAME product again — merges into one line.
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'ADD_MORE' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 'product-chips-a' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: '3' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'CHECKOUT' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'CONFIRM_ORDER' },
      });

      expect(orders).toHaveLength(1);
      expect(orders[0]!.items).toHaveLength(1);
      expect(orders[0]!.items[0]!.quantity).toBe(4); // 1 + 3, merged into one line
    });

    it('drops a product that became unavailable before checkout and asks for review again', async () => {
      const { service, productRows } = makeHarness();
      const phone = '08099900005';
      await registerToMainMenu(service, phone);
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'ORDER_SNACKS' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 'product-chips-a' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: '1' },
      });

      // Simulates the product being archived/un-priced by an admin between add-to-cart
      // and checkout — a genuine live-editable field, never something the conversation
      // client controls.
      const chips = productRows.find((p) => p.id === 'product-chips-a')!;
      chips.sellingPrice = null;

      const checkout = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'CHECKOUT' },
      });
      expect(
        checkout.messages.some(
          (m) =>
            m.type === 'TEXT' &&
            m.text.includes('no longer available') &&
            m.text.includes("We've updated your order"),
        ),
      ).toBe(true);
    });

    describe('idempotency / concurrency (order confirmation)', () => {
      it('D2COrderingService.confirmOrder replayed with the SAME idempotency key (e.g. a client retry after a lost response) returns the original order, never creates a second one', async () => {
        const productRows = makeProductFixture(ORG_A);
        const { service: consumerService, consumers } = makeConsumerService();
        await consumerService.registerConsumer(ORG_A, {
          fullName: 'Retry Test Consumer',
          phoneNumber: '08099900006',
        });
        const organisationService = {
          getById: jest.fn().mockResolvedValue({ id: ORG_A, currency: 'NGN' }),
        } as unknown as OrganisationService;
        const { service: salesOrderService, orders } = makeSalesOrderService(productRows);
        const collectionPointFulfillmentRepository = {
          findManyBySalesOrderIds: jest.fn().mockResolvedValue([]),
          findBySalesOrderId: jest.fn().mockResolvedValue(null),
        } as unknown as jest.Mocked<CollectionPointFulfillmentRepository>;
        const d2cOrderingService = new D2COrderingService(
          makeProductRepository(productRows),
          consumerService,
          organisationService,
          salesOrderService,
          collectionPointFulfillmentRepository,
        );

        const idempotencyKey = 'checkout-key-1';
        const cart = [{ productId: 'product-chips-a', quantity: 2 }];
        const first = await d2cOrderingService.confirmOrder(
          ORG_A,
          consumers[0]!.id,
          cart,
          idempotencyKey,
        );
        // A client retry (network timeout, lost response, double-tap) replays the exact
        // same request — same cart, same key.
        const retry = await d2cOrderingService.confirmOrder(
          ORG_A,
          consumers[0]!.id,
          cart,
          idempotencyKey,
        );

        expect(orders).toHaveLength(1);
        expect(first.wasCreated).toBe(true);
        expect(retry.wasCreated).toBe(false);
        expect(retry.result.orderId).toBe(first.result.orderId);
        expect(retry.result.orderCode).toBe(first.result.orderCode);
      });

      it('5 genuinely concurrent CONFIRM_ORDER requests for the same checkout create exactly one SalesOrder', async () => {
        const { service, orders } = makeHarness();
        const phone = '08099900007';
        await registerToMainMenu(service, phone);
        await service.handleInboundMessage(ORG_A, {
          channel: 'WHATSAPP',
          externalConversationId: phone,
          input: { type: 'BUTTON', value: 'ORDER_SNACKS' },
        });
        await service.handleInboundMessage(ORG_A, {
          channel: 'WHATSAPP',
          externalConversationId: phone,
          input: { type: 'LIST_SELECTION', value: 'product-chips-a' },
        });
        await service.handleInboundMessage(ORG_A, {
          channel: 'WHATSAPP',
          externalConversationId: phone,
          input: { type: 'TEXT', text: '1' },
        });
        // Reaching AWAITING_CONFIRM mints and PERSISTS the idempotency key — a single
        // sequential step, before the concurrent burst below.
        await service.handleInboundMessage(ORG_A, {
          channel: 'WHATSAPP',
          externalConversationId: phone,
          input: { type: 'BUTTON', value: 'CHECKOUT' },
        });

        await Promise.all(
          Array.from({ length: 5 }, () =>
            service.handleInboundMessage(ORG_A, {
              channel: 'WHATSAPP',
              externalConversationId: phone,
              input: { type: 'BUTTON', value: 'CONFIRM_ORDER' },
            }),
          ),
        );

        expect(orders).toHaveLength(1);
      });
    });

    it('cross-tenant: a product id from Org A is rejected when ordering as Org B', async () => {
      const { service } = makeHarness(ORG_B);
      await service.handleInboundMessage(ORG_B, {
        channel: 'WHATSAPP',
        externalConversationId: '08099900009',
        input: { type: 'TEXT', text: 'hi' },
      });
      await service.handleInboundMessage(ORG_B, {
        channel: 'WHATSAPP',
        externalConversationId: '08099900009',
        input: { type: 'BUTTON', value: 'REGISTER' },
      });
      await service.handleInboundMessage(ORG_B, {
        channel: 'WHATSAPP',
        externalConversationId: '08099900009',
        input: { type: 'TEXT', text: 'Org B Consumer' },
      });
      await service.handleInboundMessage(ORG_B, {
        channel: 'WHATSAPP',
        externalConversationId: '08099900009',
        input: { type: 'LIST_SELECTION', value: 't-ibn' },
      });
      const located = await service.handleInboundMessage(ORG_B, {
        channel: 'WHATSAPP',
        externalConversationId: '08099900009',
        input: { type: 'LIST_SELECTION', value: 't-bodija' },
      });
      expect(located.state).toBe('MAIN_MENU');
      await service.handleInboundMessage(ORG_B, {
        channel: 'WHATSAPP',
        externalConversationId: '08099900009',
        input: { type: 'BUTTON', value: 'ORDER_SNACKS' },
      });
      // Org A's own product id — must not resolve under Org B. Sprint 41:
      // `handleBrowsing` now rejects this immediately (see the earlier test's own
      // comment on why), never letting it reach quantity entry.
      const selectAttempt = await service.handleInboundMessage(ORG_B, {
        channel: 'WHATSAPP',
        externalConversationId: '08099900009',
        input: { type: 'LIST_SELECTION', value: 'product-chips-a' },
      });
      expect(selectAttempt.messages[0]).toMatchObject({
        type: 'TEXT',
        text: "That's not a valid option. Please choose one from the list.",
      });
    });

    it('an empty catalogue genuinely returns the consumer to MAIN_MENU — a subsequent menu click is never misrouted as a product selection (regression, found live)', async () => {
      const { service } = makeHarness(ORG_A, []);
      const phone = '08099900010';
      await registerToMainMenu(service, phone);

      const noProducts = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'ORDER_SNACKS' },
      });
      expect(noProducts.state).toBe('MAIN_MENU');

      const nextClick = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'MY_ACCOUNT' },
      });
      // Before the fix, this was misrouted into `handleBrowsing` (the conversation's
      // persisted state never actually left BROWSING) and asked "How many would you
      // like?" as if "MY_ACCOUNT" were a product id.
      expect(nextClick.messages[0]).toMatchObject({ type: 'TEXT' });
      expect((nextClick.messages[0] as { text: string }).text).toContain('Name:');
    });
  });

  describe('MY_ORDERS / MY_REWARDS (Sprint 41)', () => {
    async function registerToMainMenu(service: ConversationService, phone: string) {
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'REGISTER' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'Rewards Test Consumer' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 't-ibn' },
      });
      return service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 't-bodija' },
      });
    }

    it('MY_ORDERS shows "you have no orders yet" for a brand-new consumer, reusing the EXISTING D2COrderingService read — no second order-history system', async () => {
      const { service } = makeHarness();
      const phone = '08099910001';
      await registerToMainMenu(service, phone);

      const myOrders = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'MY_ORDERS' },
      });
      expect(myOrders.messages[0]).toMatchObject({
        type: 'TEXT',
        text: "You haven't placed any orders yet.",
      });
    });

    it('MY_ORDERS lists a real order with its payment status after one is placed', async () => {
      const { service } = makeHarness();
      const phone = '08099910002';
      await registerToMainMenu(service, phone);
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'ORDER_SNACKS' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 'product-chips-a' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: '1' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'CHECKOUT' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'CONFIRM_ORDER' },
      });
      // `CONFIRM_ORDER` leaves the conversation in the ordering flow's own
      // AWAITING_PAYMENT step (`confirm.state` is `ACTIVE`, not `MAIN_MENU` — see the
      // "walks Order Snacks..." test above) — MENU returns to MAIN_MENU first, the
      // same reset command a real consumer would use to check their orders later.
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'MENU' },
      });

      const myOrders = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'MY_ORDERS' },
      });
      const ordersText = myOrders.messages.find(
        (m) => m.type === 'TEXT' && m.text.includes('Your Recent Orders'),
      ) as { text: string };
      expect(ordersText).toBeDefined();
      expect(ordersText.text).toContain('SO-000001');
      expect(ordersText.text).toContain('Payment Pending');
    });

    // Sprint 42 brief §32/33 "Consumer Status Refresh."
    it('MY_ORDERS shows the real, current Collection Point fulfilment status and name — never a stale WhatsApp-only status', async () => {
      const { service, collectionPointFulfillmentRepository } = makeHarness();
      const phone = '08099910005';
      await registerToMainMenu(service, phone);
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'ORDER_SNACKS' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 'product-chips-a' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: '1' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'CHECKOUT' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'CONFIRM_ORDER' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'MENU' },
      });

      // The consumer's order is now READY_FOR_COLLECTION at a real Collection Point —
      // the EXISTING, authoritative `CollectionPointFulfillment` state this read must
      // reflect live, never a cached/independent WhatsApp status. The mock responds to
      // whatever salesOrderId was actually generated by the fake order-creation flow
      // above, rather than hardcoding one.
      collectionPointFulfillmentRepository.findManyBySalesOrderIds.mockImplementation(
        (_organisationId: string, salesOrderIds: string[]) =>
          Promise.resolve(
            salesOrderIds.map((id) => ({
              salesOrderId: id,
              status: 'READY_FOR_COLLECTION',
              outlet: { name: 'Boby Bites — Challenge' },
            })),
          ) as never,
      );

      const myOrders = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'MY_ORDERS' },
      });
      const ordersText = myOrders.messages.find(
        (m) => m.type === 'TEXT' && m.text.includes('Your Recent Orders'),
      ) as { text: string };
      expect(ordersText.text).toContain('Status: Ready for Collection');
      expect(ordersText.text).toContain('Collection Point:\nBoby Bites — Challenge');
    });

    it('MY_REWARDS shows a zero balance for a consumer with no LoyaltyAccount yet (null is a normal result, never an error)', async () => {
      const { service, loyaltyService } = makeHarness();
      const phone = '08099910003';
      await registerToMainMenu(service, phone);

      const myRewards = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'MY_REWARDS' },
      });
      expect(loyaltyService.getAccount).toHaveBeenCalled();
      expect(myRewards.messages[0]).toMatchObject({
        type: 'TEXT',
        text: expect.stringContaining('Balance: 0 points'),
      });
    });

    it('MY_REWARDS shows the real balance and recent ledger entries from the EXISTING LoyaltyService — never a second rewards calculation', async () => {
      const { service, loyaltyService } = makeHarness();
      const phone = '08099910004';
      await registerToMainMenu(service, phone);

      (loyaltyService.getAccount as jest.Mock).mockResolvedValue({ balance: 200 });
      (loyaltyService.listLedger as jest.Mock).mockResolvedValue({
        items: [
          {
            type: 'EARN',
            amount: 200,
            balanceAfter: 200,
            reason: null,
            createdAt: new Date('2026-10-01'),
          },
        ],
        total: 1,
      });

      const myRewards = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'MY_REWARDS' },
      });
      const text = (myRewards.messages[0] as { text: string }).text;
      expect(text).toContain('Balance: 200 points');
      expect(text).toContain('+200 pts');
      expect(text).toContain('Points earned');
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

  describe('Sprint 43.5 — text aliases and global commands', () => {
    async function registerToMainMenu(service: ConversationService, phone: string) {
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'REGISTER' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'Alias Test Consumer' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 't-ibn' },
      });
      return service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 't-bodija' },
      });
    }

    it('a natural-language synonym ("orders") routes to the same MY_ORDERS handler as the exact command — no NLP, just an exact alias lookup', async () => {
      const { service } = makeHarness();
      const phone = '08099920001';
      await registerToMainMenu(service, phone);

      const response = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'orders' },
      });
      expect(response.messages[0]).toMatchObject({
        type: 'TEXT',
        text: "You haven't placed any orders yet.",
      });
    });

    it('"my rewards" (lowercase, with a space) routes to MY_REWARDS', async () => {
      const { service } = makeHarness();
      const phone = '08099920002';
      await registerToMainMenu(service, phone);

      const response = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'my rewards' },
      });
      expect(response.messages[0]).toMatchObject({
        type: 'TEXT',
        text: expect.stringContaining('My Rewards'),
      });
    });

    it('"account" routes to MY_ACCOUNT', async () => {
      const { service } = makeHarness();
      const phone = '08099920003';
      await registerToMainMenu(service, phone);

      const response = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'account' },
      });
      expect(response.messages[0]).toMatchObject({
        type: 'TEXT',
        text: expect.stringContaining('Alias Test Consumer'),
      });
    });

    it('"location" routes to the EXISTING Update Location flow (LOCATION_SELECTION), never a free-text-accepted shortcut', async () => {
      const { service } = makeHarness();
      const phone = '08099920004';
      await registerToMainMenu(service, phone);

      const response = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'location' },
      });
      expect(response.state).toBe('LOCATION_SELECTION');
    });

    it('"snacks" routes to ORDER_SNACKS (ACTIVE/BROWSING)', async () => {
      const { service } = makeHarness();
      const phone = '08099920005';
      await registerToMainMenu(service, phone);

      const response = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'snacks' },
      });
      expect(response.state).toBe('ACTIVE');
    });

    it('an alias is ONLY consulted once the exact command/label/number match has already failed — a real numbered reply is never reinterpreted', async () => {
      const { service } = makeHarness();
      const phone = '08099920006';
      await registerToMainMenu(service, phone);
      // The real main menu's first option is ORDER_SNACKS — confirm the literal
      // BUTTON value (what the channel adapter would resolve "1" to) still works
      // unchanged, exercising the SAME code path the alias lookup sits behind.
      const response = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'ORDER_SNACKS' },
      });
      expect(response.state).toBe('ACTIVE');
    });

    it('CANCEL from deep inside the Order Snacks flow (BROWSING) returns to MAIN_MENU — a conversation-level reset, never a SalesOrder cancellation (none was ever created)', async () => {
      const { service, orders } = makeHarness();
      const phone = '08099920007';
      await registerToMainMenu(service, phone);
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'ORDER_SNACKS' },
      });

      const response = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'cancel' },
      });
      expect(response.state).toBe('MAIN_MENU');
      expect(orders).toHaveLength(0);
    });

    it('a CONFIRMED order survives BACK/CANCEL — conversation cancellation never touches an already-created SalesOrder', async () => {
      const { service, orders } = makeHarness();
      const phone = '08099920008';
      await registerToMainMenu(service, phone);
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'ORDER_SNACKS' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 'product-chips-a' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: '2' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'CHECKOUT' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'CONFIRM_ORDER' },
      });
      expect(orders).toHaveLength(1);

      const response = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'back' },
      });
      expect(response.state).toBe('MAIN_MENU');
      // The order placed before "back" was sent is still there, completely
      // unaffected — conversation cancellation is never business cancellation.
      expect(orders).toHaveLength(1);
    });

    it('HOME works from the main menu itself (idempotent — no error, just re-shows the menu)', async () => {
      const { service } = makeHarness();
      const phone = '08099920009';
      await registerToMainMenu(service, phone);

      const response = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'home' },
      });
      expect(response.state).toBe('MAIN_MENU');
      expect(response.messages.some((m) => m.type === 'BUTTONS')).toBe(true);
    });

    it('an unmatched selection at ORDER_CONFIRMATION explicitly says it did not understand before re-showing the options (brief Phase 8)', async () => {
      const { service } = makeHarness();
      const phone = '08099920010';
      await registerToMainMenu(service, phone);
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'ORDER_SNACKS' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 'product-chips-a' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: '1' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'CHECKOUT' },
      });

      const response = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'maybe' },
      });
      expect(response.messages[0]).toMatchObject({
        type: 'TEXT',
        text: expect.stringContaining("didn't understand"),
      });
      expect(response.messages.some((m) => m.type === 'BUTTONS')).toBe(true);
    });

    it('an unmatched selection at AWAITING_REMOVE explicitly says it did not understand before re-showing the list (brief Phase 8)', async () => {
      const { service } = makeHarness();
      const phone = '08099920011';
      await registerToMainMenu(service, phone);
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'ORDER_SNACKS' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 'product-chips-a' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: '1' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'REMOVE_ITEM' },
      });

      const response = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'huh?' },
      });
      expect(response.messages[0]).toMatchObject({
        type: 'TEXT',
        text: expect.stringContaining("didn't understand"),
      });
      expect(response.messages.some((m) => m.type === 'LIST')).toBe(true);
    });

    it('the real "Cancel" button at ORDER_CONFIRMATION still works unchanged — resolved by the channel adapter BEFORE the global CANCEL alias is ever consulted here', async () => {
      const { service, orders } = makeHarness();
      const phone = '08099920012';
      await registerToMainMenu(service, phone);
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'ORDER_SNACKS' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 'product-chips-a' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: '1' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'CHECKOUT' },
      });

      // The channel adapter would have resolved a typed "Cancel" to this exact
      // BUTTON value (the option's own label) — this test exercises that
      // already-resolved shape directly, proving `CANCEL_ORDER`'s own tailored
      // handling (not the generic global CANCEL reset) still runs.
      const response = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'CANCEL_ORDER' },
      });
      expect(response.messages[0]).toMatchObject({ type: 'TEXT', text: 'Order cancelled.' });
      expect(orders).toHaveLength(0);
    });
  });

  describe('Sprint 44 — tenant conversation configuration', () => {
    async function registerToMainMenu(service: ConversationService, phone: string) {
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'REGISTER' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'Config Test Consumer' },
      });
      await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 't-ibn' },
      });
      return service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'LIST_SELECTION', value: 't-bodija' },
      });
    }

    it('a disabled capability disappears from the menu AND cannot be invoked directly by its internal value — the exact same shape a stale numbered reply or a typed internal command would use', async () => {
      const { service, configService } = makeHarness();
      const phone = '08099930001';
      await registerToMainMenu(service, phone);

      // Simulate a tenant that has disabled MY_REWARDS — the fake resolver below is
      // ONLY used for THIS test's calls, proving the disabled-capability guard reads
      // live from whatever `resolveEffectiveConfig` returns on each call, never a
      // cached/stale menu.
      configService.resolveEffectiveConfig.mockImplementation(async () => ({
        organisationId: ORG_A,
        businessName: 'Boby Bites',
        supportPhone: null,
        supportEmail: null,
        capabilities: DEFAULT_CAPABILITY_ORDER.map((capability, index) => ({
          capability,
          enabled: capability !== 'MY_REWARDS',
          displayLabel: DEFAULT_CAPABILITY_LABELS[capability],
          sortOrder: index,
        })),
        messages: { ...DEFAULT_MESSAGES },
      }));

      const menu = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'TEXT', text: 'menu' },
      });
      // "menu" resolves through handleReset → mainMenuResponse, which emits
      // [greeting TEXT, BUTTONS menu] — the menu itself is the SECOND message.
      const options = (menu.messages[1] as { options: { value: string }[] }).options;
      expect(options.map((o) => o.value)).not.toContain('MY_REWARDS');

      // Direct invocation by the exact internal value, as if a real WhatsApp adapter
      // had resolved a stale numbered reply or a literal typed command to it — must be
      // rejected exactly like any other unmatched input, never routed to showMyRewards.
      const response = await service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: phone,
        input: { type: 'BUTTON', value: 'MY_REWARDS' },
      });
      expect(response.messages[0]).toMatchObject({
        type: 'TEXT',
        text: expect.stringContaining("didn't understand"),
      });
    });

    it('two different tenant configurations (different welcome message, different menu label) are served by the EXACT SAME ConversationService CLASS, each via its own tenant-scoped config resolution — proving "shared engine, tenant-specific experience"; Tenant A never sees Tenant B\'s wording and vice versa', async () => {
      // Two independent harnesses (the SAME established pattern this file's own
      // pre-existing "tenant isolation" describe block already uses for ORG_A/ORG_B) —
      // both instantiate the literal same `ConversationService` class with no
      // per-tenant subclass/branch of any kind; only each one's OWN
      // `D2CConversationConfigService` mock differs, exactly mirroring how the REAL
      // resolver would return different rows for different `organisationId`s.
      const harnessA = makeHarness(ORG_A);
      const harnessB = makeHarness(ORG_B);
      harnessA.configService.resolveEffectiveConfig.mockResolvedValue({
        organisationId: ORG_A,
        businessName: 'Boby Bites',
        supportPhone: null,
        supportEmail: null,
        capabilities: DEFAULT_CAPABILITY_ORDER.map((capability, index) => ({
          capability,
          enabled: true,
          displayLabel: DEFAULT_CAPABILITY_LABELS[capability],
          sortOrder: index,
        })),
        messages: { ...DEFAULT_MESSAGES, WELCOME: 'Welcome to Boby Bites! 👋' },
      });
      harnessB.configService.resolveEffectiveConfig.mockResolvedValue({
        organisationId: ORG_B,
        businessName: 'XYZ Foods',
        supportPhone: null,
        supportEmail: null,
        capabilities: DEFAULT_CAPABILITY_ORDER.map((capability, index) => ({
          capability,
          enabled: true,
          displayLabel:
            capability === 'ORDER_SNACKS'
              ? '🛍️ Shop Products'
              : DEFAULT_CAPABILITY_LABELS[capability],
          sortOrder: index,
        })),
        messages: { ...DEFAULT_MESSAGES, WELCOME: 'Welcome to XYZ Foods! 👋' },
      });

      const responseA = await harnessA.service.handleInboundMessage(ORG_A, {
        channel: 'WHATSAPP',
        externalConversationId: '08099930002',
        input: { type: 'TEXT', text: 'hi' },
      });
      const responseB = await harnessB.service.handleInboundMessage(ORG_B, {
        channel: 'WHATSAPP',
        externalConversationId: '08099930003',
        input: { type: 'TEXT', text: 'hi' },
      });

      expect((responseA.messages[0] as { text: string }).text).toContain('Boby Bites');
      expect((responseA.messages[0] as { text: string }).text).not.toContain('XYZ Foods');
      expect((responseB.messages[0] as { text: string }).text).toContain('XYZ Foods');
      expect((responseB.messages[0] as { text: string }).text).not.toContain('Boby Bites');
    });
  });
});
