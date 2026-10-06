import { Injectable } from '@nestjs/common';
import {
  Prisma,
  Promotion,
  PromotionBenefitType,
  PromotionConditionType,
  PromotionStatus,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export type PromotionWithRelations = Promotion & {
  conditions: {
    id: string;
    type: PromotionConditionType;
    minOrderValue: number | null;
    productId: string | null;
    minQuantity: number | null;
    territoryId: string | null;
  }[];
  benefits: {
    id: string;
    type: PromotionBenefitType;
    pointsValue: number | null;
    freeProductId: string | null;
    freeProductQuantity: number | null;
  }[];
};

/** A condition/benefit's own typed fields, with neither `organisationId` nor
 *  `promotionId` — both are attached by the repository at the point of use (nested
 *  create vs. `createMany`), keeping `PromotionService`'s condition/benefit-building
 *  helpers agnostic to which write shape the caller ultimately needs. */
export type PromotionConditionFields = Omit<
  Prisma.PromotionConditionUncheckedCreateInput,
  'organisationId' | 'promotionId' | 'id' | 'createdAt'
>;
export type PromotionBenefitFields = Omit<
  Prisma.PromotionBenefitUncheckedCreateInput,
  'organisationId' | 'promotionId' | 'id' | 'createdAt'
>;

export interface ListPromotionsParams {
  status?: PromotionStatus;
  search?: string;
}

const RELATIONS_INCLUDE = {
  conditions: {
    select: {
      id: true,
      type: true,
      minOrderValue: true,
      productId: true,
      minQuantity: true,
      territoryId: true,
    },
  },
  benefits: {
    select: {
      id: true,
      type: true,
      pointsValue: true,
      freeProductId: true,
      freeProductQuantity: true,
    },
  },
};

export interface CreatePromotionData {
  organisationId: string;
  name: string;
  description?: string;
  startsAt: Date;
  endsAt: Date;
  conditions: PromotionConditionFields[];
  benefits: PromotionBenefitFields[];
  createdById?: string;
}

/**
 * Thin Prisma access for the `Promotion` aggregate (Sprint 40, docs/domains/d2c.md). No
 * business logic — the DRAFT-only-editable rule, the activation completeness check, and
 * every condition/benefit value-shape validation live in `PromotionService`; this file
 * only knows how to read/write rows.
 *
 * Tenant-safety convention (matches every other repository in this codebase): every
 * method that reads or writes a specific promotion takes `organisationId` and includes
 * it in the query.
 */
@Injectable()
export class PromotionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Prisma's nested `conditions: {create: [...]}`/`benefits: {create: [...]}` write is
   *  already atomic — no explicit `$transaction` needed for a pure create, same as
   *  `SalesOrderRepository.create`. */
  create(data: CreatePromotionData): Promise<PromotionWithRelations> {
    return this.prisma.promotion.create({
      data: {
        organisationId: data.organisationId,
        name: data.name,
        description: data.description,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        createdById: data.createdById,
        updatedById: data.createdById,
        conditions: {
          create: data.conditions.map((c) => ({ ...c, organisationId: data.organisationId })),
        },
        benefits: {
          create: data.benefits.map((b) => ({ ...b, organisationId: data.organisationId })),
        },
      },
      include: RELATIONS_INCLUDE,
    });
  }

  findById(organisationId: string, id: string): Promise<PromotionWithRelations | null> {
    return this.prisma.promotion.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  async findManyPaginated(
    organisationId: string,
    params: ListPromotionsParams & { page: number; pageSize: number },
  ): Promise<{ items: PromotionWithRelations[]; total: number }> {
    const where: Prisma.PromotionWhereInput = {
      organisationId,
      ...(params.status ? { status: params.status } : {}),
      ...(params.search ? { name: { contains: params.search, mode: 'insensitive' as const } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.promotion.findMany({
        where,
        include: RELATIONS_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.promotion.count({ where }),
    ]);
    return { items, total };
  }

  /** `status: ACTIVE` AND the evaluation instant actually falls within
   *  `[startsAt, endsAt]` — never inferred from `status` alone (docs/domains/d2c.md
   *  "Promotion Validity and Lifecycle": "do not rely solely on the current promotion
   *  status"). The sole read `PromotionEvaluationService` uses. */
  findManyActiveEffective(organisationId: string, at: Date): Promise<PromotionWithRelations[]> {
    return this.prisma.promotion.findMany({
      where: {
        organisationId,
        status: PromotionStatus.ACTIVE,
        startsAt: { lte: at },
        endsAt: { gte: at },
      },
      include: RELATIONS_INCLUDE,
    });
  }

  /** Header-only update — `name`/`description`/`startsAt`/`endsAt`. Scoped to `DRAFT` by
   *  the SERVICE (this method itself is a plain tenant-scoped update, matching the
   *  convention every other repository's `update` method already follows — it does not
   *  independently re-check status). */
  async updateHeader(
    organisationId: string,
    id: string,
    data: { name?: string; description?: string; startsAt?: Date; endsAt?: Date },
    updatedById?: string,
  ): Promise<PromotionWithRelations | null> {
    const result = await this.prisma.promotion.updateMany({
      where: { id, organisationId },
      data: { ...data, updatedById },
    });
    if (result.count === 0) {
      return null;
    }
    return this.findById(organisationId, id);
  }

  /** Delete-then-recreate within one transaction — the exact `SalesOrderRepository
   *  .update`'s own `items: {deleteMany} + {createMany}` shape, applied here to
   *  conditions/benefits. Only reachable while `status === DRAFT` (service-enforced). */
  async replaceConditionsAndBenefits(
    organisationId: string,
    id: string,
    conditions: PromotionConditionFields[],
    benefits: PromotionBenefitFields[],
  ): Promise<PromotionWithRelations> {
    return this.prisma.$transaction(async (tx) => {
      await tx.promotionCondition.deleteMany({ where: { promotionId: id } });
      await tx.promotionBenefit.deleteMany({ where: { promotionId: id } });
      if (conditions.length > 0) {
        await tx.promotionCondition.createMany({
          data: conditions.map((c) => ({ ...c, promotionId: id, organisationId })),
        });
      }
      if (benefits.length > 0) {
        await tx.promotionBenefit.createMany({
          data: benefits.map((b) => ({ ...b, promotionId: id, organisationId })),
        });
      }
      return tx.promotion.findUniqueOrThrow({ where: { id }, include: RELATIONS_INCLUDE });
    });
  }

  /** Conditional `updateMany` scoped to the row's CURRENT status — the standard
   *  concurrency-guard primitive used throughout this codebase
   *  (`SalesOrderRepository.updateStatus`, `CollectionPointFulfillmentRepository
   *  .updateStatus`) — a transition attempted from any status other than one of
   *  `fromStatuses` matches zero rows, a safe no-op the service turns into a specific
   *  error. */
  async updateStatus(
    organisationId: string,
    id: string,
    fromStatuses: PromotionStatus[],
    data: Prisma.PromotionUpdateManyMutationInput,
  ): Promise<PromotionWithRelations | null> {
    const result = await this.prisma.promotion.updateMany({
      where: { id, organisationId, status: { in: fromStatuses } },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.findById(organisationId, id);
  }
}
