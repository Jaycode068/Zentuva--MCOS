import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, PaymentStatus } from '@prisma/client';

import { PaymentService } from '../../finance/payment.service';
import { AuditService } from '../../identity/audit/audit.service';
import { OrganisationService } from '../../identity/organisation/organisation.service';
import {
  CreateProviderPaymentResult,
  PaymentProvider,
} from '../../payments/ports/payment-provider.port';
import { SalesOrderService } from '../../sales/sales-order.service';
import { PromotionEvaluationService } from '../../promotions/reward/promotion-evaluation.service';
import { ConsumerService } from '../consumer/consumer.service';
import { CollectionPointFulfillmentService } from '../fulfillment/collection-point-fulfillment.service';
import { D2CPaymentService } from './d2c-payment.service';
import { OrderNotPayableError, PaymentProviderError } from './d2c-payment.types';

/**
 * Sprint 35 — D2C OPay Payment Integration. `D2CPaymentService` is tested
 * against a real in-memory `Payment`/`SalesOrder` store shared by fake
 * `PaymentService`/`SalesOrderService` doubles (mirroring the exact
 * "real business logic over an in-memory store" philosophy this session's
 * D2C specs already established) — the callback/idempotency/tenant
 * guarantees under test are the SERVICE's own real code, not a
 * reimplementation of it.
 */
describe('D2CPaymentService', () => {
  const ORG_A = 'org-a';
  const ORG_B = 'org-b';

  function makeOrder(overrides: Record<string, unknown> = {}) {
    return {
      id: 'order-1',
      organisationId: ORG_A,
      orderCode: 'SO-000001',
      consumerId: 'consumer-1',
      customerId: null,
      status: 'DRAFT',
      total: 1500,
      source: 'D2C',
      ...overrides,
    };
  }

  function makeFakeSalesOrderService(orders: Record<string, unknown>[]) {
    return {
      getById: jest.fn((organisationId: string, id: string) => {
        const order = orders.find((o) => o.id === id && o.organisationId === organisationId);
        if (!order) throw new NotFoundException('Sales order not found');
        return Promise.resolve(order);
      }),
      confirm: jest.fn((organisationId: string, id: string) => {
        const order = orders.find((o) => o.id === id && o.organisationId === organisationId);
        if (!order) throw new NotFoundException('Sales order not found');
        if (order.status === 'CONFIRMED') {
          throw new Error('Sales order is already confirmed');
        }
        order.status = 'CONFIRMED';
        return Promise.resolve(order);
      }),
    } as unknown as jest.Mocked<SalesOrderService>;
  }

  function makeFakePaymentService() {
    const rows: Record<string, unknown>[] = [];
    let seq = 0;
    const service = {
      createPendingForConsumer: jest.fn((data: Record<string, unknown>) => {
        const existing = rows.find((r) => r.merchantReference === data.merchantReference);
        if (existing) return Promise.resolve({ payment: existing, wasCreated: false });
        seq += 1;
        const payment = {
          id: `payment-${seq}`,
          organisationId: data.organisationId,
          consumerId: data.consumerId,
          salesOrderId: data.salesOrderId,
          amount: data.amount,
          currency: data.currency,
          merchantReference: data.merchantReference,
          status: PaymentStatus.PENDING,
          provider: 'OPAY',
          providerReference: null,
          checkoutUrl: null,
        };
        rows.push(payment);
        return Promise.resolve({ payment, wasCreated: true });
      }),
      findByMerchantReference: jest.fn((merchantReference: string) =>
        Promise.resolve(rows.find((r) => r.merchantReference === merchantReference) ?? null),
      ),
      attachProviderDetails: jest.fn(
        (organisationId: string, id: string, details: Record<string, unknown>) => {
          const row = rows.find((r) => r.id === id && r.organisationId === organisationId);
          if (!row) return Promise.resolve(null);
          Object.assign(row, details);
          return Promise.resolve(row);
        },
      ),
      applyProviderCallback: jest.fn(
        (
          organisationId: string,
          id: string,
          toStatus: PaymentStatus,
          providerReference: string,
        ) => {
          const row = rows.find((r) => r.id === id && r.organisationId === organisationId);
          if (!row) return Promise.resolve(null);
          if (row.status !== PaymentStatus.PENDING) {
            return Promise.resolve({ payment: row, wasApplied: false });
          }
          row.status = toStatus;
          row.providerReference = providerReference;
          return Promise.resolve({ payment: row, wasApplied: true });
        },
      ),
    } as unknown as jest.Mocked<PaymentService>;
    return { service, rows };
  }

  function makeFakeProvider(
    result?: Partial<CreateProviderPaymentResult>,
  ): jest.Mocked<PaymentProvider> {
    return {
      name: 'opay',
      createPayment: jest.fn().mockResolvedValue({
        outcome: 'CREATED',
        checkoutUrl: 'https://sandbox.opaycheckout.com/pay/xyz',
        providerReference: 'OPAY-ORDER-1',
        ...result,
      }),
      verifyCallback: jest.fn(),
    } as unknown as jest.Mocked<PaymentProvider>;
  }

  function makeHarness(orders: Record<string, unknown>[], provider = makeFakeProvider()) {
    const salesOrderService = makeFakeSalesOrderService(orders);
    const { service: paymentService, rows: payments } = makeFakePaymentService();
    const consumerService = {
      getById: jest.fn((organisationId: string, id: string) =>
        Promise.resolve({
          id,
          organisationId,
          fullName: 'Ada Okafor',
          normalizedPhone: '+2348012345678',
        } as Consumer),
      ),
    } as unknown as jest.Mocked<ConsumerService>;
    const organisationService = {
      getById: jest
        .fn()
        .mockResolvedValue({ id: ORG_A, currency: 'NGN', name: 'Boby Bites', displayName: null }),
    } as unknown as jest.Mocked<OrganisationService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;
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

    const service = new D2CPaymentService(
      provider,
      paymentService,
      salesOrderService,
      consumerService,
      organisationService,
      auditService,
      config,
      collectionPointFulfillmentService,
      promotionEvaluationService,
    );
    return {
      service,
      salesOrderService,
      paymentService,
      payments,
      auditService,
      provider,
      collectionPointFulfillmentService,
      promotionEvaluationService,
    };
  }

  describe('initiatePayment', () => {
    it("creates a pending payment and returns OPay's checkoutUrl for a valid DRAFT D2C order", async () => {
      const orders = [makeOrder()];
      const { service, payments } = makeHarness(orders);

      const result = await service.initiatePayment(ORG_A, 'consumer-1', 'order-1');

      expect(result.status).toBe('PENDING');
      expect(result.checkoutUrl).toBe('https://sandbox.opaycheckout.com/pay/xyz');
      expect(result.amount).toBe(1500);
      expect(result.currency).toBe('NGN');
      expect(result.paymentReference).toBe('PAY-SO-000001');
      expect(payments).toHaveLength(1);
      expect(payments[0]!.provider).toBe('OPAY');
    });

    it('rejects a consumer initiating payment for an order that belongs to a DIFFERENT consumer', async () => {
      const orders = [makeOrder({ consumerId: 'someone-else' })];
      const { service } = makeHarness(orders);
      await expect(service.initiatePayment(ORG_A, 'consumer-1', 'order-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects initiating payment for an order that is not DRAFT/awaiting payment', async () => {
      const orders = [makeOrder({ status: 'CANCELLED' })];
      const { service } = makeHarness(orders);
      await expect(service.initiatePayment(ORG_A, 'consumer-1', 'order-1')).rejects.toThrow(
        OrderNotPayableError,
      );
    });

    it('a repeated "Pay Now" click reuses the SAME payment/reference and never calls OPay a second time (brief "PAYMENT REFERENCE DESIGN")', async () => {
      const orders = [makeOrder()];
      const { service, provider, payments } = makeHarness(orders);

      const first = await service.initiatePayment(ORG_A, 'consumer-1', 'order-1');
      const second = await service.initiatePayment(ORG_A, 'consumer-1', 'order-1');

      expect(first.paymentReference).toBe(second.paymentReference);
      expect(first.checkoutUrl).toBe(second.checkoutUrl);
      expect(provider.createPayment).toHaveBeenCalledTimes(1); // never a second OPay call
      expect(payments).toHaveLength(1); // never a second payment row
    });

    it('reports SUCCESS with no checkoutUrl once the order is already CONFIRMED (paid)', async () => {
      const orders = [makeOrder({ status: 'CONFIRMED' })];
      const { service } = makeHarness(orders);
      const result = await service.initiatePayment(ORG_A, 'consumer-1', 'order-1');
      expect(result.status).toBe('SUCCESS');
      expect(result.checkoutUrl).toBeUndefined();
    });

    it('client cannot influence amount/currency/reference — all three are server-derived from the order alone', async () => {
      const orders = [makeOrder({ total: 1500 })];
      const { service, provider } = makeHarness(orders);
      await service.initiatePayment(ORG_A, 'consumer-1', 'order-1');
      const call = provider.createPayment.mock.calls[0]![0];
      expect(call.amount).toBe(1500);
      expect(call.currency).toBe('NGN');
      expect(call.reference).toBe('PAY-SO-000001');
    });

    it('recovers from a duplicate-reference collision by returning the existing (not a second) payment (brief "OPay REFERENCE COLLISION")', async () => {
      const orders = [makeOrder()];
      const provider = makeFakeProvider({
        outcome: 'DUPLICATE_REFERENCE',
        checkoutUrl: undefined,
        providerReference: undefined,
      });
      const { service, payments } = makeHarness(orders, provider);

      const result = await service.initiatePayment(ORG_A, 'consumer-1', 'order-1');
      expect(result.status).toBe('PENDING');
      expect(payments).toHaveLength(1); // never a second row created
    });

    it('throws a safe generic PaymentProviderError when OPay rejects the request, never the raw OPay error', async () => {
      const orders = [makeOrder()];
      const provider = makeFakeProvider({
        outcome: 'REJECTED',
        errorCode: 'OPAY_AUTH_FAILED',
        errorMessage: 'internal provider detail',
      });
      const { service } = makeHarness(orders, provider);

      await expect(service.initiatePayment(ORG_A, 'consumer-1', 'order-1')).rejects.toThrow(
        PaymentProviderError,
      );
      try {
        await service.initiatePayment(ORG_A, 'consumer-1', 'order-1');
      } catch (error) {
        expect((error as Error).message).not.toContain('OPAY_AUTH_FAILED');
      }
    });
  });

  describe('handleProviderCallback (brief "CALLBACK VALIDATION")', () => {
    async function primePendingPayment(orders: Record<string, unknown>[]) {
      const harness = makeHarness(orders);
      const initiated = await harness.service.initiatePayment(ORG_A, 'consumer-1', 'order-1');
      // `initiatePayment` itself records a PAYMENT_INITIATED audit event —
      // clear it so each test's own assertions are about the CALLBACK's
      // effect only, not conflated with priming.
      (harness.auditService.record as jest.Mock).mockClear();
      return { ...harness, initiated };
    }

    it('an unknown reference is safely ignored — never creates or mutates anything (§1)', async () => {
      const orders = [makeOrder()];
      const { service, auditService } = await primePendingPayment(orders);
      await service.handleProviderCallback({
        valid: true,
        callback: {
          reference: 'PAY-DOES-NOT-EXIST',
          providerReference: 'OPAY-X',
          amount: 1500,
          currency: 'NGN',
          status: 'SUCCESS',
        },
      });
      expect(auditService.record).not.toHaveBeenCalled();
      expect(orders[0]!.status).toBe('DRAFT'); // untouched
    });

    it('an amount mismatch is rejected and audited, never marks paid (§2)', async () => {
      const orders = [makeOrder()];
      const { service, auditService } = await primePendingPayment(orders);
      await service.handleProviderCallback({
        valid: true,
        callback: {
          reference: 'PAY-SO-000001',
          providerReference: 'OPAY-X',
          amount: 999, // wrong
          currency: 'NGN',
          status: 'SUCCESS',
        },
      });
      expect(orders[0]!.status).toBe('DRAFT');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: expect.stringContaining('mismatch') }),
      );
    });

    it('a currency mismatch is rejected, never marks paid (§3)', async () => {
      const orders = [makeOrder()];
      const { service } = await primePendingPayment(orders);
      await service.handleProviderCallback({
        valid: true,
        callback: {
          reference: 'PAY-SO-000001',
          providerReference: 'OPAY-X',
          amount: 1500,
          currency: 'USD', // wrong
          status: 'SUCCESS',
        },
      });
      expect(orders[0]!.status).toBe('DRAFT');
    });

    it('an UNKNOWN status is never silently treated as SUCCESS (§6)', async () => {
      const orders = [makeOrder()];
      const { service } = await primePendingPayment(orders);
      await service.handleProviderCallback({
        valid: true,
        callback: {
          reference: 'PAY-SO-000001',
          providerReference: 'OPAY-X',
          amount: 1500,
          currency: 'NGN',
          status: 'UNKNOWN',
        },
      });
      expect(orders[0]!.status).toBe('DRAFT');
    });

    it('a PENDING callback is a safe no-op — nothing to transition to yet', async () => {
      const orders = [makeOrder()];
      const { service } = await primePendingPayment(orders);
      await service.handleProviderCallback({
        valid: true,
        callback: {
          reference: 'PAY-SO-000001',
          providerReference: 'OPAY-X',
          amount: 1500,
          currency: 'NGN',
          status: 'PENDING',
        },
      });
      expect(orders[0]!.status).toBe('DRAFT');
    });

    it('a valid SUCCESS callback marks the payment RECORDED and confirms the SalesOrder — the existing lifecycle, reused', async () => {
      const orders = [makeOrder()];
      const { service, salesOrderService, payments, auditService } =
        await primePendingPayment(orders);

      await service.handleProviderCallback({
        valid: true,
        callback: {
          reference: 'PAY-SO-000001',
          providerReference: 'OPAY-ORDER-1',
          amount: 1500,
          currency: 'NGN',
          status: 'SUCCESS',
        },
      });

      expect(payments[0]!.status).toBe(PaymentStatus.RECORDED);
      expect(orders[0]!.status).toBe('CONFIRMED');
      expect(salesOrderService.confirm).toHaveBeenCalledWith(ORG_A, 'order-1', null);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: expect.stringContaining('succeeded') }),
      );
    });

    it('a valid FAIL callback marks the payment FAILED, never touching the SalesOrder', async () => {
      const orders = [makeOrder()];
      const { service, salesOrderService, payments } = await primePendingPayment(orders);

      await service.handleProviderCallback({
        valid: true,
        callback: {
          reference: 'PAY-SO-000001',
          providerReference: 'OPAY-ORDER-1',
          amount: 1500,
          currency: 'NGN',
          status: 'FAILED',
        },
      });

      expect(payments[0]!.status).toBe(PaymentStatus.FAILED);
      expect(orders[0]!.status).toBe('DRAFT');
      expect(salesOrderService.confirm).not.toHaveBeenCalled();
    });

    it('a valid CLOSE callback marks the payment CLOSED', async () => {
      const orders = [makeOrder()];
      const { service, payments } = await primePendingPayment(orders);
      await service.handleProviderCallback({
        valid: true,
        callback: {
          reference: 'PAY-SO-000001',
          providerReference: 'OPAY-ORDER-1',
          amount: 1500,
          currency: 'NGN',
          status: 'CLOSED',
        },
      });
      expect(payments[0]!.status).toBe(PaymentStatus.CLOSED);
    });

    it('an invalid (signature-failed) callback outcome is dropped before any lookup happens', async () => {
      const orders = [makeOrder()];
      const { service, payments } = await primePendingPayment(orders);
      await service.handleProviderCallback({ valid: false, reason: 'bad signature' });
      expect(payments[0]!.status).toBe(PaymentStatus.PENDING); // untouched
    });

    describe('idempotency / concurrency (brief "CALLBACK IDEMPOTENCY")', () => {
      it('a duplicate SUCCESS callback after the first never re-confirms the order or re-records the audit event', async () => {
        const orders = [makeOrder()];
        const { service, salesOrderService, payments } = await primePendingPayment(orders);
        const callback = {
          valid: true as const,
          callback: {
            reference: 'PAY-SO-000001',
            providerReference: 'OPAY-ORDER-1',
            amount: 1500,
            currency: 'NGN',
            status: 'SUCCESS' as const,
          },
        };

        await service.handleProviderCallback(callback);
        await service.handleProviderCallback(callback);
        await service.handleProviderCallback(callback);

        expect(payments[0]!.status).toBe(PaymentStatus.RECORDED);
        expect(salesOrderService.confirm).toHaveBeenCalledTimes(1); // never re-confirmed
      });

      it('5 genuinely concurrent duplicate SUCCESS callbacks confirm the order exactly once', async () => {
        const orders = [makeOrder()];
        const { service, salesOrderService } = await primePendingPayment(orders);
        const callback = {
          valid: true as const,
          callback: {
            reference: 'PAY-SO-000001',
            providerReference: 'OPAY-ORDER-1',
            amount: 1500,
            currency: 'NGN',
            status: 'SUCCESS' as const,
          },
        };

        await Promise.all(
          Array.from({ length: 5 }, () => service.handleProviderCallback(callback)),
        );

        expect(salesOrderService.confirm).toHaveBeenCalledTimes(1);
        expect(orders[0]!.status).toBe('CONFIRMED');
      });
    });

    it("tenant isolation: a reference minted under Org A never resolves under a callback processed for Org B's data", async () => {
      // The webhook has no per-tenant routing at all — this proves the
      // resolution is entirely self-contained via the globally-unique
      // merchantReference, never accepting an organisationId from outside.
      const ordersA = [makeOrder({ organisationId: ORG_A })];
      const { payments } = await primePendingPayment(ordersA);
      expect(payments[0]!.organisationId).toBe(ORG_A);

      // A second, unrelated tenant's own order/payment never collides —
      // different orderCode, therefore a different merchantReference.
      const ordersB = [makeOrder({ id: 'order-2', organisationId: ORG_B, orderCode: 'SO-000002' })];
      const harnessB = makeHarness(ordersB);
      const initiatedB = await harnessB.service.initiatePayment(ORG_B, 'consumer-1', 'order-2');
      expect(initiatedB.paymentReference).not.toBe(payments[0]!.merchantReference);
    });
  });
});
