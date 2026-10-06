import { Injectable, NotFoundException } from '@nestjs/common';
import { PromotionStatus } from '@prisma/client';
import {
  CreatePromotionInput,
  PromotionBenefitInput,
  PromotionConditionInput,
  UpdatePromotionInput,
} from '@zentuva/validation';

import { ProductRepository } from '../../catalogue/product/product.repository';
import { TerritoryRepository } from '../../retail/territory/territory.repository';
import {
  ListPromotionsParams,
  PromotionBenefitFields,
  PromotionConditionFields,
  PromotionRepository,
  PromotionWithRelations,
} from './promotion.repository';
import {
  InvalidPromotionConditionError,
  InvalidPromotionTransitionError,
  PromotionNotActivatableError,
  PromotionNotEditableError,
} from './promotion.types';

/**
 * Sprint 40 — Configurable Promotions, Loyalty, Rewards & Consumer Incentives
 * (docs/domains/d2c.md). THE business-rule layer for the Promotion/Condition/Benefit
 * configuration model — "configurable" means these rules are evaluated against
 * persisted rows, never hard-coded per promotion (docs/domains/d2c.md "Critical Business
 * Requirement"). Validates every condition/benefit's referenced `productId`/
 * `territoryId` belongs to this tenant before ever persisting a row.
 */
@Injectable()
export class PromotionService {
  constructor(
    private readonly promotionRepository: PromotionRepository,
    private readonly productRepository: ProductRepository,
    private readonly territoryRepository: TerritoryRepository,
  ) {}

  getById(organisationId: string, id: string): Promise<PromotionWithRelations> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(
    organisationId: string,
    params: ListPromotionsParams & { page: number; pageSize: number },
  ): Promise<{ items: PromotionWithRelations[]; total: number }> {
    return this.promotionRepository.findManyPaginated(organisationId, params);
  }

  async create(
    organisationId: string,
    input: CreatePromotionInput,
    actorUserId: string,
  ): Promise<PromotionWithRelations> {
    const conditions = await this.toConditionCreateInputs(organisationId, input.conditions);
    const benefits = input.benefit ? [this.toBenefitCreateInput(input.benefit)] : [];

    return this.promotionRepository.create({
      organisationId,
      name: input.name,
      description: input.description,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      conditions,
      benefits,
      createdById: actorUserId,
    });
  }

  /** Only reachable while `status === DRAFT` (docs/domains/d2c.md "Promotion History and
   *  Version Preservation") — once a promotion has been activated even once, its
   *  conditions/benefit are immutable; a new commercial term is always a NEW promotion
   *  row, never an edit to this one. */
  async update(
    organisationId: string,
    id: string,
    input: UpdatePromotionInput,
    actorUserId: string,
  ): Promise<PromotionWithRelations> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    if (existing.status !== PromotionStatus.DRAFT) {
      throw new PromotionNotEditableError(
        'This promotion has already been activated and can no longer be edited — create a new promotion for different terms',
      );
    }

    const headerChanged =
      input.name !== undefined ||
      input.description !== undefined ||
      input.startsAt !== undefined ||
      input.endsAt !== undefined;
    if (headerChanged) {
      const updated = await this.promotionRepository.updateHeader(
        organisationId,
        id,
        {
          name: input.name,
          description: input.description,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
        },
        actorUserId,
      );
      if (!updated) {
        throw new NotFoundException('Promotion not found');
      }
    }

    if (input.conditions !== undefined || input.benefit !== undefined) {
      const conditions = input.conditions
        ? await this.toConditionCreateInputs(organisationId, input.conditions)
        : existing.conditions.map((c) => this.existingConditionToCreateInput(c));
      const benefits = input.benefit
        ? [this.toBenefitCreateInput(input.benefit)]
        : existing.benefits.map((b) => this.existingBenefitToCreateInput(b));
      return this.promotionRepository.replaceConditionsAndBenefits(
        organisationId,
        id,
        conditions,
        benefits,
      );
    }

    return this.getByIdOrThrow(organisationId, id);
  }

  /** `DRAFT -> ACTIVE`. Requires at least one condition and EXACTLY one benefit —
   *  activating an incomplete configuration would let a promotion exist that could never
   *  actually produce a grant (brief: "evaluate using their persisted configuration"). */
  async activate(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<PromotionWithRelations> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    if (existing.conditions.length === 0) {
      throw new PromotionNotActivatableError(
        'A promotion needs at least one eligibility condition before it can be activated',
      );
    }
    if (existing.benefits.length !== 1) {
      throw new PromotionNotActivatableError(
        'A promotion needs exactly one benefit before it can be activated',
      );
    }
    const updated = await this.promotionRepository.updateStatus(
      organisationId,
      id,
      [PromotionStatus.DRAFT],
      { status: PromotionStatus.ACTIVE, activatedAt: new Date(), updatedById: actorUserId },
    );
    if (!updated) {
      throw new InvalidPromotionTransitionError('Only a draft promotion can be activated');
    }
    return updated;
  }

  async pause(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<PromotionWithRelations> {
    const updated = await this.promotionRepository.updateStatus(
      organisationId,
      id,
      [PromotionStatus.ACTIVE],
      { status: PromotionStatus.PAUSED, updatedById: actorUserId },
    );
    if (!updated) {
      throw new InvalidPromotionTransitionError('Only an active promotion can be paused');
    }
    return updated;
  }

  async resume(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<PromotionWithRelations> {
    const updated = await this.promotionRepository.updateStatus(
      organisationId,
      id,
      [PromotionStatus.PAUSED],
      { status: PromotionStatus.ACTIVE, updatedById: actorUserId },
    );
    if (!updated) {
      throw new InvalidPromotionTransitionError('Only a paused promotion can be resumed');
    }
    return updated;
  }

  private async toConditionCreateInputs(
    organisationId: string,
    conditions: PromotionConditionInput[],
  ): Promise<PromotionConditionFields[]> {
    const results: PromotionConditionFields[] = [];
    for (const condition of conditions) {
      if (condition.type === 'PRODUCT_QUANTITY') {
        const product = await this.productRepository.findById(organisationId, condition.productId);
        if (!product) {
          throw new InvalidPromotionConditionError(
            `Product ${condition.productId} not found for this organisation`,
          );
        }
        results.push({
          type: 'PRODUCT_QUANTITY',
          productId: condition.productId,
          minQuantity: condition.minQuantity,
        });
      } else if (condition.type === 'TERRITORY') {
        const territory = await this.territoryRepository.findById(
          organisationId,
          condition.territoryId,
        );
        if (!territory) {
          throw new InvalidPromotionConditionError(
            `Territory ${condition.territoryId} not found for this organisation`,
          );
        }
        results.push({ type: 'TERRITORY', territoryId: condition.territoryId });
      } else if (condition.type === 'MINIMUM_ORDER_VALUE') {
        results.push({ type: 'MINIMUM_ORDER_VALUE', minOrderValue: condition.minOrderValue });
      } else {
        results.push({ type: 'FIRST_QUALIFYING_ORDER' });
      }
    }
    return results;
  }

  private toBenefitCreateInput(benefit: PromotionBenefitInput): PromotionBenefitFields {
    if (benefit.type === 'BONUS_POINTS') {
      return { type: 'BONUS_POINTS', pointsValue: benefit.pointsValue };
    }
    return {
      type: 'FREE_PRODUCT',
      freeProductId: benefit.freeProductId,
      freeProductQuantity: benefit.freeProductQuantity,
    };
  }

  private existingConditionToCreateInput(
    condition: PromotionWithRelations['conditions'][number],
  ): PromotionConditionFields {
    return {
      type: condition.type,
      minOrderValue: condition.minOrderValue,
      productId: condition.productId,
      minQuantity: condition.minQuantity,
      territoryId: condition.territoryId,
    };
  }

  private existingBenefitToCreateInput(
    benefit: PromotionWithRelations['benefits'][number],
  ): PromotionBenefitFields {
    return {
      type: benefit.type,
      pointsValue: benefit.pointsValue,
      freeProductId: benefit.freeProductId,
      freeProductQuantity: benefit.freeProductQuantity,
    };
  }

  private async getByIdOrThrow(
    organisationId: string,
    id: string,
  ): Promise<PromotionWithRelations> {
    const promotion = await this.promotionRepository.findById(organisationId, id);
    if (!promotion) {
      throw new NotFoundException('Promotion not found');
    }
    return promotion;
  }
}
