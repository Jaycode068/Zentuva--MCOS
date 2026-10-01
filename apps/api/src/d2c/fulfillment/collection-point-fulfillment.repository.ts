import { Injectable } from '@nestjs/common';
import {
  CollectionPointFulfillment,
  CollectionPointFulfillmentStatus,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export type CollectionPointFulfillmentWithRelations = CollectionPointFulfillment & {
  outlet: { id: string; name: string; collectionPointResponsibleUserId: string | null };
  salesOrder: {
    id: string;
    orderCode: string;
    status: string;
    consumerId: string | null;
    orderDate: Date;
    total: number;
    consumer: { id: string; fullName: string; phoneNumber: string } | null;
    items: { id: string; quantity: number; product: { id: string; name: string; unit: string } }[];
  };
};

const RELATIONS_INCLUDE = {
  outlet: { select: { id: true, name: true, collectionPointResponsibleUserId: true } },
  salesOrder: {
    select: {
      id: true,
      orderCode: true,
      status: true,
      consumerId: true,
      orderDate: true,
      total: true,
      consumer: { select: { id: true, fullName: true, phoneNumber: true } },
      items: {
        select: {
          id: true,
          quantity: true,
          product: { select: { id: true, name: true, unit: true } },
        },
      },
    },
  },
};

/**
 * Thin Prisma access for `CollectionPointFulfillment` (Sprint 37,
 * docs/domains/d2c.md). No business logic — see `CollectionPointFulfillmentService`.
 *
 * Tenant-safety convention (matches every other repository in this codebase): every
 * method that reads or writes a specific row takes `organisationId` and includes it in
 * the query. `updateStatus` is the EXACT `SalesOrderRepository.updateStatus` shape — a
 * conditional `updateMany` scoped to `{id, organisationId, status: {in: fromStatuses}}`,
 * giving concurrent transition attempts a deterministic final state (only one call can
 * ever match a given row's current status).
 */
@Injectable()
export class CollectionPointFulfillmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    data: Prisma.CollectionPointFulfillmentCreateInput,
  ): Promise<CollectionPointFulfillmentWithRelations> {
    return this.prisma.collectionPointFulfillment.create({ data, include: RELATIONS_INCLUDE });
  }

  findById(
    organisationId: string,
    id: string,
  ): Promise<CollectionPointFulfillmentWithRelations | null> {
    return this.prisma.collectionPointFulfillment.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  findBySalesOrderId(
    organisationId: string,
    salesOrderId: string,
  ): Promise<CollectionPointFulfillmentWithRelations | null> {
    return this.prisma.collectionPointFulfillment.findFirst({
      where: { salesOrderId, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  findManyByOutlet(
    organisationId: string,
    outletId: string,
    statuses?: CollectionPointFulfillmentStatus[],
  ): Promise<CollectionPointFulfillmentWithRelations[]> {
    return this.prisma.collectionPointFulfillment.findMany({
      where: {
        organisationId,
        outletId,
        ...(statuses ? { status: { in: statuses } } : {}),
      },
      include: RELATIONS_INCLUDE,
      orderBy: { assignedAt: 'asc' },
    });
  }

  /** Conditional `updateMany` scoped to the row's CURRENT status — the exact
   *  `SalesOrderRepository.updateStatus` concurrency primitive. A transition attempted
   *  from any status other than one of `fromStatuses` matches zero rows, a safe no-op the
   *  service turns into a specific error (already-in-that-state, or out-of-order). */
  async updateStatus(
    organisationId: string,
    id: string,
    fromStatuses: CollectionPointFulfillmentStatus[],
    data: Prisma.CollectionPointFulfillmentUpdateManyMutationInput,
  ): Promise<CollectionPointFulfillmentWithRelations | null> {
    const result = await this.prisma.collectionPointFulfillment.updateMany({
      where: { id, organisationId, status: { in: fromStatuses } },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.collectionPointFulfillment.findUniqueOrThrow({
      where: { id },
      include: RELATIONS_INCLUDE,
    });
  }
}
