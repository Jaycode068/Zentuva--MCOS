import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus } from '@prisma/client';

import { PaymentService } from '../../finance/payment.service';
import { AuditService } from '../../identity/audit/audit.service';
import { OrganisationService } from '../../identity/organisation/organisation.service';
import {
  CallbackVerificationOutcome,
  PAYMENT_PROVIDER,
  PaymentProvider,
  ProviderCallbackStatus,
} from '../../payments/ports/payment-provider.port';
import { SalesOrderService } from '../../sales/sales-order.service';
import { PromotionEvaluationService } from '../../promotions/reward/promotion-evaluation.service';
import { ConsumerService } from '../consumer/consumer.service';
import { CollectionPointFulfillmentService } from '../fulfillment/collection-point-fulfillment.service';
import { D2C_PAYMENT_AUDIT_ACTIONS } from './d2c-payment-audit-actions';
import {
  D2CPaymentResult,
  D2CPaymentStatus,
  OrderNotPayableError,
  PaymentProviderError,
} from './d2c-payment.types';

/** Maps OPay's already-neutralised callback status (from `PaymentProvider.
 *  verifyCallback`) onto the EXISTING `PaymentStatus` enum — brief "PAYMENT
 *  STATES": no duplicate status system, only two genuinely new values
 *  reused from Sprint 35's own additive `PENDING`/`FAILED`/`CLOSED`, and
 *  `SUCCESS` maps onto the pre-existing `RECORDED` (an OPay-confirmed
 *  payment IS, from that moment on, an ordinary recorded receipt — the same
 *  meaning `RECORDED` already carries for a manually-entered B2B payment). */
function toPaymentStatus(status: ProviderCallbackStatus): PaymentStatus | null {
  switch (status) {
    case 'SUCCESS':
      return PaymentStatus.RECORDED;
    case 'FAILED':
      return PaymentStatus.FAILED;
    case 'CLOSED':
      return PaymentStatus.CLOSED;
    default:
      return null; // PENDING/UNKNOWN — nothing to transition to yet.
  }
}

function toD2CStatus(status: PaymentStatus): D2CPaymentStatus {
  switch (status) {
    case PaymentStatus.RECORDED:
      return 'SUCCESS';
    case PaymentStatus.FAILED:
      return 'FAILED';
    case PaymentStatus.CLOSED:
      return 'CLOSED';
    default:
      return 'PENDING';
  }
}

/** `PAY-{orderCode}` — deterministic, derived from `SalesOrder.orderCode`
 *  (itself already globally unique — Sprint 4.8), never randomly minted.
 *  The one stable identity a repeated "Pay Now" click, a retried callback,
 *  and OPay's own `reference` field all resolve to
 *  (docs/domains/d2c.md "Payment Reference Design"). */
function buildMerchantReference(orderCode: string): string {
  return `PAY-${orderCode}`;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Sprint 35 — D2C OPay Payment Integration (docs/domains/d2c.md "Payment
 * Architecture"). The "Zentuva Payment Application" the brief describes —
 * sits between the Conversation Layer and the existing Finance/Sales
 * domains exactly like `D2COrderingService` sits between the Conversation
 * Layer and Finance/Sales for ordering (Sprint 34): validates the Consumer
 * and the order, builds the payment request, and delegates the actual
 * `Payment` row and the `SalesOrder` state transition entirely to
 * `PaymentService`/`SalesOrderService` — never a parallel payment or order
 * model of its own.
 */
@Injectable()
export class D2CPaymentService {
  private readonly logger = new Logger(D2CPaymentService.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    private readonly paymentService: PaymentService,
    private readonly salesOrderService: SalesOrderService,
    private readonly consumerService: ConsumerService,
    private readonly organisationService: OrganisationService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
    private readonly collectionPointFulfillmentService: CollectionPointFulfillmentService,
    private readonly promotionEvaluationService: PromotionEvaluationService,
  ) {}

  /**
   * brief "PAYMENT CREATION FLOW" — the sole entry point the Conversation
   * Layer calls. Idempotent by construction: the SAME `SalesOrder` always
   * resolves to the SAME `merchantReference`, so a repeated "Pay Now"
   * click reuses whatever payment attempt already exists rather than
   * minting a second, unrelated OPay reference (brief "PAYMENT REFERENCE
   * DESIGN").
   */
  async initiatePayment(
    organisationId: string,
    consumerId: string,
    salesOrderId: string,
  ): Promise<D2CPaymentResult> {
    const order = await this.salesOrderService.getById(organisationId, salesOrderId);
    if (order.consumerId !== consumerId) {
      // Never reveal whether the order exists for a DIFFERENT consumer —
      // same shape as `D2COrderingService.getConsumerOrder`'s ownership
      // check (Sprint 34).
      throw new NotFoundException('Order not found');
    }
    if (order.status === 'CONFIRMED') {
      const existing = await this.paymentService.findByMerchantReference(
        buildMerchantReference(order.orderCode),
      );
      const currency = existing?.currency ?? (await this.getOrganisationCurrency(organisationId));
      return this.toResult(
        order.orderCode,
        existing?.amount ?? order.total,
        currency,
        existing?.status ?? PaymentStatus.RECORDED,
        null,
      );
    }
    if (order.status !== 'DRAFT') {
      throw new OrderNotPayableError('This order is not awaiting payment.');
    }

    const currency = await this.getOrganisationCurrency(organisationId);
    const merchantReference = buildMerchantReference(order.orderCode);

    const { payment, wasCreated } = await this.paymentService.createPendingForConsumer({
      organisationId,
      consumerId,
      salesOrderId,
      amount: order.total,
      currency,
      merchantReference,
    });

    if (!wasCreated) {
      if (payment.status === PaymentStatus.PENDING && payment.checkoutUrl) {
        // Reuse — never a second OPay call while one is already in flight.
        return this.toResult(
          order.orderCode,
          payment.amount,
          payment.currency,
          payment.status,
          payment.checkoutUrl,
        );
      }
      if (payment.status !== PaymentStatus.PENDING) {
        // Already resolved (SUCCESS/FAILED/CLOSED) — report it as-is rather
        // than attempting a second gateway call with a reference OPay may
        // already consider settled. A genuine "retry after failure" flow
        // is documented as deferred (docs/domains/d2c.md "Deferred Scope").
        return this.toResult(
          order.orderCode,
          payment.amount,
          payment.currency,
          payment.status,
          undefined,
        );
      }
      // PENDING with no checkoutUrl yet — a prior OPay call never
      // completed (network failure/timeout); fall through and retry it
      // now, using this SAME already-created payment/reference.
    }

    const consumer = await this.consumerService.getById(organisationId, consumerId);
    if (!consumer) {
      throw new NotFoundException('Consumer not found');
    }
    const organisation = await this.organisationService.getById(organisationId);
    const displayName = organisation?.displayName ?? organisation?.name ?? 'Zentuva';
    const webBaseUrl = this.config.get<string>('webBaseUrl');

    const created = await this.paymentProvider.createPayment({
      reference: merchantReference,
      amount: order.total,
      currency,
      returnUrl: `${webBaseUrl}/payment/${merchantReference}?outcome=return`,
      cancelUrl: `${webBaseUrl}/payment/${merchantReference}?outcome=cancel`,
      callbackUrl: this.config.get<string>('opay.webhookUrl')!,
      displayName,
      customer: {
        reference: consumer.id,
        name: consumer.fullName,
        phoneNumber: consumer.normalizedPhone,
      },
      productDescription: `Order ${order.orderCode}`,
    });

    if (created.outcome === 'CREATED') {
      await this.paymentService.attachProviderDetails(organisationId, payment.id, {
        providerReference: created.providerReference,
        checkoutUrl: created.checkoutUrl,
      });
      await this.auditService.record({
        action: D2C_PAYMENT_AUDIT_ACTIONS.PAYMENT_INITIATED,
        entityType: 'Payment',
        entityId: payment.id,
        organisationId,
        metadata: { merchantReference, orderCode: order.orderCode },
      });
      return this.toResult(
        order.orderCode,
        order.total,
        currency,
        PaymentStatus.PENDING,
        created.checkoutUrl,
      );
    }

    if (created.outcome === 'DUPLICATE_REFERENCE') {
      // brief "OPay REFERENCE COLLISION" — OPay already knows this
      // reference from an earlier attempt this row lost track of (e.g. we
      // created it, then crashed before persisting the checkoutUrl).
      // Recover via lookup rather than blindly minting a second payment.
      this.logger.warn(
        `OPay reported duplicate reference for ${merchantReference}; returning existing payment`,
      );
      return this.toResult(
        order.orderCode,
        payment.amount,
        payment.currency,
        PaymentStatus.PENDING,
        undefined,
      );
    }

    if (created.outcome === 'REJECTED') {
      // A definitive, synchronous rejection — not ambiguous like a
      // timeout — safe to mark this attempt FAILED outright.
      await this.paymentService.applyProviderCallback(
        organisationId,
        payment.id,
        PaymentStatus.FAILED,
        '',
      );
    }
    // UNAVAILABLE (network/timeout) is deliberately left PENDING — brief
    // "NETWORK FAILURE": "a network timeout can mean request unknown, not
    // payment definitely failed" — a future retry reuses this exact row.

    throw new PaymentProviderError(
      "We couldn't start your payment right now. Please try again later.",
    );
  }

  /** brief "PAYMENT QUERY / RECONCILIATION" / the conversation's own
   *  "check my payment" and the public return-URL page both resolve
   *  through here — ownership-enforced when `consumerId` is supplied
   *  (the Conversation Layer always has one); the public return page has
   *  no consumer identity at all, so it calls {@link getPublicPaymentStatus}
   *  instead, which intentionally omits this check (the unguessable
   *  reference itself is the only thing gating access, the same
   *  "public but only discoverable via an opaque id" shape the public
   *  careers page already established, Sprint 30). */
  async getPaymentStatus(
    organisationId: string,
    consumerId: string,
    merchantReference: string,
  ): Promise<D2CPaymentResult> {
    const payment = await this.paymentService.findByMerchantReference(merchantReference);
    if (
      !payment ||
      payment.organisationId !== organisationId ||
      payment.consumerId !== consumerId
    ) {
      throw new NotFoundException('Payment not found');
    }
    const order = await this.salesOrderService.getById(organisationId, payment.salesOrderId!);
    return this.toResult(
      order.orderCode,
      payment.amount,
      payment.currency,
      payment.status,
      payment.checkoutUrl ?? undefined,
    );
  }

  /** The return-URL page's own query — brief "RETURN URL": "the return
   *  page should display the current Zentuva payment state by querying
   *  Zentuva," never treat arriving at the return URL itself as proof of
   *  payment. No tenant/consumer context available here at all (OPay just
   *  redirects a browser); the globally-unique, unguessable
   *  `merchantReference` is the only thing this endpoint trusts. */
  async getPublicPaymentStatus(merchantReference: string): Promise<D2CPaymentResult> {
    const payment = await this.paymentService.findByMerchantReference(merchantReference);
    if (!payment || !payment.salesOrderId) {
      throw new NotFoundException('Payment not found');
    }
    const order = await this.salesOrderService.getById(
      payment.organisationId,
      payment.salesOrderId,
    );
    return this.toResult(
      order.orderCode,
      payment.amount,
      payment.currency,
      payment.status,
      undefined,
    );
  }

  /**
   * The webhook's own business-logic entry point — called only AFTER
   * `PaymentProvider.verifyCallback` has already confirmed authenticity
   * (brief "CALLBACK SECURITY"). Every validation below fails CLOSED
   * (silently, safely, never throwing past the controller) — an invalid
   * callback must never crash the endpoint OPay is retrying against, but
   * must also never mutate financial state (brief "CALLBACK VALIDATION").
   */
  async handleProviderCallback(outcome: CallbackVerificationOutcome): Promise<void> {
    if (!outcome.valid) {
      this.logger.warn(`Rejected OPay callback: ${outcome.reason}`);
      return;
    }
    const cb = outcome.callback;

    const payment = await this.paymentService.findByMerchantReference(cb.reference);
    if (!payment) {
      // brief "CALLBACK VALIDATION §1" — unknown reference.
      this.logger.warn('OPay callback references an unknown payment; ignored');
      return;
    }
    if (payment.provider !== 'OPAY') {
      // brief §4 — provider mismatch (structurally shouldn't happen, since
      // only OPay payments ever get a `merchantReference`, but checked
      // explicitly as defense in depth).
      this.logger.warn(
        `OPay callback for payment ${payment.id} which has no OPAY provider; ignored`,
      );
      return;
    }
    if (roundCurrency(payment.amount) !== roundCurrency(cb.amount)) {
      // brief §2 — amount mismatch. Never mark paid; record an auditable
      // exception rather than silently dropping it.
      await this.auditService.record({
        action: D2C_PAYMENT_AUDIT_ACTIONS.CALLBACK_AMOUNT_MISMATCH,
        entityType: 'Payment',
        entityId: payment.id,
        organisationId: payment.organisationId,
        metadata: { expected: payment.amount, received: cb.amount },
      });
      this.logger.warn(`OPay callback amount mismatch for payment ${payment.id}`);
      return;
    }
    if (payment.currency !== cb.currency) {
      // brief §3 — currency mismatch.
      this.logger.warn(`OPay callback currency mismatch for payment ${payment.id}`);
      return;
    }

    const toStatus = toPaymentStatus(cb.status);
    if (!toStatus) {
      // PENDING (nothing to do yet) or UNKNOWN (brief §6 — never silently
      // becomes SUCCESS).
      if (cb.status === 'UNKNOWN') {
        this.logger.warn(`OPay callback carried an unrecognized status for payment ${payment.id}`);
      }
      return;
    }

    const applied = await this.paymentService.applyProviderCallback(
      payment.organisationId,
      payment.id,
      toStatus,
      cb.providerReference,
    );
    if (!applied || !applied.wasApplied) {
      // Idempotent no-op — either not found (shouldn't happen, we just
      // read it) or already resolved by an earlier callback (brief
      // "CALLBACK IDEMPOTENCY" — a duplicate SUCCESS/SUCCESS/SUCCESS must
      // never re-apply).
      return;
    }

    if (toStatus === PaymentStatus.RECORDED) {
      // brief "PAYMENT SUCCESS -> FINANCE" / "SALES ORDER PAYMENT STATE" —
      // the ONE existing Sales Order lifecycle transition this maps onto;
      // never a new D2C-specific status. Tolerates an already-CONFIRMED
      // order (a concurrent duplicate callback racing this one) as a safe
      // no-op rather than a hard failure.
      try {
        await this.salesOrderService.confirm(payment.organisationId, payment.salesOrderId!, null);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('already confirmed')) {
          throw error;
        }
      }
      await this.auditService.record({
        action: D2C_PAYMENT_AUDIT_ACTIONS.PAYMENT_SUCCEEDED,
        entityType: 'Payment',
        entityId: payment.id,
        organisationId: payment.organisationId,
        metadata: { merchantReference: cb.reference, providerReference: cb.providerReference },
      });
      // Sprint 37 — best-effort Collection Point auto-assignment (docs/domains/d2c.md
      // "Order Assignment Model"). Deliberately never allowed to fail this webhook: "no
      // eligible Collection Point" is a real, expected, already-audited outcome inside
      // `autoAssign()` itself, not an exception; anything else here is logged, never
      // thrown, matching this handler's own "an invalid/unexpected callback must never
      // crash the endpoint OPay is retrying against" rule.
      try {
        await this.collectionPointFulfillmentService.autoAssign(
          payment.organisationId,
          payment.salesOrderId!,
        );
      } catch (error) {
        this.logger.error(
          `Collection Point auto-assignment failed for payment ${payment.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      // Sprint 40 — best-effort promotion evaluation (docs/domains/d2c.md "Qualifying
      // Events"). The SAME integration shape as Collection Point auto-assignment above:
      // never allowed to fail this webhook — "the consumer didn't qualify for any
      // promotion" is a normal, expected outcome inside `evaluateOrderQualification`
      // itself (an empty array), not an exception; anything else here is logged, never
      // thrown.
      try {
        await this.promotionEvaluationService.evaluateOrderQualification(
          payment.organisationId,
          payment.consumerId!,
          payment.salesOrderId!,
        );
      } catch (error) {
        this.logger.error(
          `Promotion evaluation failed for payment ${payment.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    } else {
      await this.auditService.record({
        action: D2C_PAYMENT_AUDIT_ACTIONS.PAYMENT_RESOLVED,
        entityType: 'Payment',
        entityId: payment.id,
        organisationId: payment.organisationId,
        metadata: { merchantReference: cb.reference, status: toStatus },
      });
    }
  }

  private async getOrganisationCurrency(organisationId: string): Promise<string> {
    const organisation = await this.organisationService.getById(organisationId);
    return organisation?.currency ?? 'NGN';
  }

  private toResult(
    orderCode: string,
    amount: number,
    currency: string,
    status: PaymentStatus,
    checkoutUrl: string | null | undefined,
  ): D2CPaymentResult {
    return {
      paymentReference: buildMerchantReference(orderCode),
      orderReference: orderCode,
      amount,
      currency,
      status: toD2CStatus(status),
      ...(checkoutUrl ? { checkoutUrl } : {}),
    };
  }
}
