import { Injectable } from '@nestjs/common';
import { BillOfMaterial, BillOfMaterialStatus, Prisma, ProductType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListBillOfMaterialsParams {
  productId?: string;
  status?: BillOfMaterialStatus;
  /** Simple case-insensitive substring match against the BOM number or the finished
   *  product's name — same convention as every other domain's `search` filter. */
  search?: string;
}

const PRODUCT_SELECT = { id: true, code: true, name: true, type: true, unit: true };

export type BillOfMaterialWithRelations = BillOfMaterial & {
  product: { id: string; code: string; name: string; type: ProductType; unit: string };
  items: {
    id: string;
    componentProductId: string;
    quantity: number;
    unitOfMeasure: string;
    notes: string | null;
    componentProduct: { id: string; code: string; name: string; type: ProductType; unit: string };
  }[];
};

const RELATIONS_INCLUDE = {
  product: { select: PRODUCT_SELECT },
  items: {
    include: { componentProduct: { select: PRODUCT_SELECT } },
    orderBy: { createdAt: 'asc' as const },
  },
};

/**
 * Thin Prisma access for the `BillOfMaterial` aggregate (Sprint 4.6,
 * docs/domains/production.md). No business logic here — validation (finished-product-
 * only, component-type restriction, duplicate components) lives in
 * `BillOfMaterialService`; this file only knows how to read/write rows.
 *
 * `activate` is the one method that owns a multi-row atomic write: setting a BOM active
 * and deactivating any prior active BOM for the same product must happen together, same
 * "repository owns the atomic transaction" convention as `GoodsReceiptRepository.receive`.
 */
@Injectable()
export class BillOfMaterialRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.BillOfMaterialCreateInput): Promise<BillOfMaterialWithRelations> {
    return this.prisma.billOfMaterial.create({ data, include: RELATIONS_INCLUDE });
  }

  findById(organisationId: string, id: string): Promise<BillOfMaterialWithRelations | null> {
    return this.prisma.billOfMaterial.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListBillOfMaterialsParams = {},
  ): Promise<BillOfMaterialWithRelations[]> {
    return this.prisma.billOfMaterial.findMany({
      where: {
        organisationId,
        ...(params.productId ? { productId: params.productId } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.search
          ? {
              OR: [
                { bomNumber: { contains: params.search, mode: 'insensitive' } },
                { product: { name: { contains: params.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: RELATIONS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** The one `ACTIVE` bill of materials for a finished product, if any — the row a
   *  Production Order pins at creation time. */
  findActiveByProduct(
    organisationId: string,
    productId: string,
  ): Promise<BillOfMaterialWithRelations | null> {
    return this.prisma.billOfMaterial.findFirst({
      where: { organisationId, productId, status: BillOfMaterialStatus.ACTIVE },
      include: RELATIONS_INCLUDE,
    });
  }

  /** Globally unique (see `BillOfMaterial.bomNumber` schema comment) — checked without
   *  an `organisationId` filter, same convention as `Product.code`/`PurchaseOrder.
   *  purchaseOrderNumber`. */
  async existsByNumber(bomNumber: string): Promise<boolean> {
    const count = await this.prisma.billOfMaterial.count({ where: { bomNumber } });
    return count > 0;
  }

  /** Updates header fields and, when `items` is provided, replaces the entire component
   *  list within the same transaction (delete-then-recreate, same shape as
   *  `PurchaseOrderRepository.update`). Returns `null` if no row matched
   *  `(id, organisationId)`. Only ever called while `status === DRAFT` — enforced by
   *  `BillOfMaterialService`, not here. */
  async update(
    organisationId: string,
    id: string,
    headerData: Prisma.BillOfMaterialUncheckedUpdateManyInput,
    items?: {
      componentProductId: string;
      quantity: number;
      unitOfMeasure: string;
      notes?: string;
    }[],
  ): Promise<BillOfMaterialWithRelations | null> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.billOfMaterial.updateMany({
        where: { id, organisationId },
        data: headerData,
      });
      if (result.count === 0) {
        return null;
      }

      if (items) {
        await tx.billOfMaterialItem.deleteMany({ where: { billOfMaterialId: id } });
        await tx.billOfMaterialItem.createMany({
          data: items.map((item) => ({ ...item, billOfMaterialId: id })),
        });
      }

      return tx.billOfMaterial.findUniqueOrThrow({ where: { id }, include: RELATIONS_INCLUDE });
    });
  }

  /** `DRAFT`/`INACTIVE` → `ACTIVE`, and — inside the same transaction — any other
   *  `ACTIVE` bill of materials for the same finished product becomes `INACTIVE` (brief
   *  §5: "Only one BOM should be active for a finished product at a time"). Returns
   *  `null` if the target row didn't match `(id, organisationId, status IN [DRAFT,
   *  INACTIVE])`. */
  async activate(
    organisationId: string,
    id: string,
    productId: string,
    actorUserId: string,
  ): Promise<{
    activated: BillOfMaterialWithRelations;
    deactivated: BillOfMaterial | null;
  } | null> {
    return this.prisma.$transaction(async (tx) => {
      const transition = await tx.billOfMaterial.updateMany({
        where: {
          id,
          organisationId,
          status: { in: [BillOfMaterialStatus.DRAFT, BillOfMaterialStatus.INACTIVE] },
        },
        data: { status: BillOfMaterialStatus.ACTIVE, updatedById: actorUserId },
      });
      if (transition.count === 0) {
        return null;
      }

      const priorActive = await tx.billOfMaterial.findFirst({
        where: { organisationId, productId, status: BillOfMaterialStatus.ACTIVE, id: { not: id } },
      });
      let deactivated: BillOfMaterial | null = null;
      if (priorActive) {
        deactivated = await tx.billOfMaterial.update({
          where: { id: priorActive.id },
          data: { status: BillOfMaterialStatus.INACTIVE, updatedById: actorUserId },
        });
      }

      const activated = await tx.billOfMaterial.findUniqueOrThrow({
        where: { id },
        include: RELATIONS_INCLUDE,
      });
      return { activated, deactivated };
    });
  }

  /** `ACTIVE` → `INACTIVE`. Returns `null` if no row matched
   *  `(id, organisationId, status === ACTIVE)`. */
  async deactivate(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<BillOfMaterial | null> {
    const result = await this.prisma.billOfMaterial.updateMany({
      where: { id, organisationId, status: BillOfMaterialStatus.ACTIVE },
      data: { status: BillOfMaterialStatus.INACTIVE, updatedById: actorUserId },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.billOfMaterial.findUniqueOrThrow({ where: { id } });
  }
}
