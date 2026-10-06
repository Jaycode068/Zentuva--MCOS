import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../../identity/audit/audit.service';
import { SalesOrderService } from '../../sales/sales-order.service';
import { ConsumerService } from '../../d2c/consumer/consumer.service';
import { PromotionRepository, PromotionWithRelations } from '../promotion/promotion.repository';
import { REWARD_GRANT_AUDIT_ACTIONS } from './reward-grant-audit-actions';
import { ConsumerRewardGrantWithRelations, RewardGrantRepository } from './reward-grant.repository';

interface EvaluationOutcome {
  qualifies: boolean;
  snapshot: Prisma.InputJsonValue[];
}

/**
 * Sprint 40 — Configurable Promotions, Loyalty, Rewards & Consumer Incentives
 * (docs/domains/d2c.md). THE reusable promotion-evaluation engine the brief insists on
 * (docs/domains/d2c.md "Promotion Evaluation") — takes only plain ids, knows nothing
 * about HTTP, webhooks, or any channel, so it is equally callable from the D2C payment
 * webhook (this sprint's one caller), a future Conversation Layer/WhatsApp adapter, or
 * Sprint 41/42's simulator, without ANY of them needing their own copy of this logic.
 *
 * Condition evaluation is a controlled `switch` over `PromotionConditionType` — never a
 * generic expression evaluator (brief §8) — every branch reads one piece of ALREADY
 * fetched, already-existing data (`SalesOrder`/`Consumer`), never a second query engine.
 */
@Injectable()
export class PromotionEvaluationService {
  private readonly logger = new Logger(PromotionEvaluationService.name);

  constructor(
    private readonly promotionRepository: PromotionRepository,
    private readonly rewardGrantRepository: RewardGrantRepository,
    private readonly salesOrderService: SalesOrderService,
    private readonly consumerService: ConsumerService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * The one entry point (docs/domains/d2c.md "Qualifying Events"). Called only after the
   * EXISTING Sales/Payment architecture has already made `salesOrderId` authoritative
   * (`CONFIRMED` or later) — never evaluated against a `DRAFT` order, a payment-link
   * creation, or any other pre-authoritative state. Evaluates EVERY currently
   * active-and-effective promotion independently (docs/domains/d2c.md "Multiple
   * Promotions" — the deliberately simple, documented default: no stacking suppression,
   * no priority ranking; a consumer who genuinely qualifies for three simultaneous
   * promotions receives all three grants). Never throws for an ordinary "didn't
   * qualify" outcome — only for a genuine infrastructure failure, which the caller
   * (`D2CPaymentService`) is responsible for catching exactly like it already does for
   * `CollectionPointFulfillmentService.autoAssign()`.
   */
  async evaluateOrderQualification(
    organisationId: string,
    consumerId: string,
    salesOrderId: string,
  ): Promise<ConsumerRewardGrantWithRelations[]> {
    const order = await this.salesOrderService.getById(organisationId, salesOrderId);
    if (order.source !== 'D2C') {
      // Brief test #10 — an existing B2B order must never accidentally qualify. The only
      // caller today is the D2C payment webhook, so this branch is structurally
      // unreachable in practice; kept as an explicit, defensive, documented guard for
      // when this service gains a second caller.
      return [];
    }
    if (!['CONFIRMED', 'PARTIALLY_FULFILLED', 'FULFILLED'].includes(order.status)) {
      return [];
    }
    const consumer = await this.consumerService.getById(organisationId, consumerId);
    if (!consumer) {
      return [];
    }

    const now = new Date();
    const promotions = await this.promotionRepository.findManyActiveEffective(organisationId, now);

    const grants: ConsumerRewardGrantWithRelations[] = [];
    for (const promotion of promotions) {
      const outcome = await this.evaluateConditions(
        organisationId,
        promotion,
        consumer,
        order,
        salesOrderId,
      );
      if (!outcome.qualifies) {
        continue;
      }
      const benefit = promotion.benefits[0];
      if (!benefit) {
        // Activation requires exactly one benefit — unreachable for an ACTIVE promotion,
        // kept as a defensive guard rather than a non-null assertion.
        continue;
      }

      const { grant, wasCreated } = await this.rewardGrantRepository.createWithEarn({
        organisationId,
        consumerId,
        promotionId: promotion.id,
        qualifyingSalesOrderId: salesOrderId,
        promotionNameSnapshot: promotion.name,
        benefitTypeSnapshot: benefit.type,
        pointsAwardedSnapshot: benefit.pointsValue,
        freeProductIdSnapshot: benefit.freeProductId,
        freeProductQuantitySnapshot: benefit.freeProductQuantity,
        conditionsSnapshot: outcome.snapshot,
      });
      grants.push(grant);

      if (wasCreated) {
        await this.auditService.record({
          action: REWARD_GRANT_AUDIT_ACTIONS.GRANTED,
          entityType: 'ConsumerRewardGrant',
          entityId: grant.id,
          organisationId,
          metadata: {
            promotionId: promotion.id,
            consumerId,
            salesOrderId,
            benefitType: benefit.type,
            pointsAwarded: benefit.pointsValue,
          },
        });
      } else {
        this.logger.debug(
          `Reward grant for promotion ${promotion.id}/consumer ${consumerId} already existed — idempotent no-op`,
        );
      }
    }
    return grants;
  }

  private async evaluateConditions(
    organisationId: string,
    promotion: PromotionWithRelations,
    consumer: { id: string; territoryId: string | null },
    order: { total: number; items: { productId: string; quantity: number }[] },
    salesOrderId: string,
  ): Promise<EvaluationOutcome> {
    const snapshot: Prisma.InputJsonValue[] = [];
    for (const condition of promotion.conditions) {
      switch (condition.type) {
        case 'FIRST_QUALIFYING_ORDER': {
          const priorCount = await this.salesOrderService.countOtherQualifyingD2COrders(
            organisationId,
            consumer.id,
            salesOrderId,
          );
          snapshot.push({ type: condition.type });
          if (priorCount > 0) {
            return { qualifies: false, snapshot };
          }
          break;
        }
        case 'MINIMUM_ORDER_VALUE': {
          snapshot.push({ type: condition.type, minOrderValue: condition.minOrderValue });
          if (order.total < (condition.minOrderValue ?? 0)) {
            return { qualifies: false, snapshot };
          }
          break;
        }
        case 'PRODUCT_QUANTITY': {
          const quantity = order.items
            .filter((item) => item.productId === condition.productId)
            .reduce((sum, item) => sum + item.quantity, 0);
          snapshot.push({
            type: condition.type,
            productId: condition.productId,
            minQuantity: condition.minQuantity,
          });
          if (quantity < (condition.minQuantity ?? 0)) {
            return { qualifies: false, snapshot };
          }
          break;
        }
        case 'TERRITORY': {
          snapshot.push({ type: condition.type, territoryId: condition.territoryId });
          if (consumer.territoryId !== condition.territoryId) {
            return { qualifies: false, snapshot };
          }
          break;
        }
        default:
          return { qualifies: false, snapshot };
      }
    }
    return { qualifies: true, snapshot };
  }
}
