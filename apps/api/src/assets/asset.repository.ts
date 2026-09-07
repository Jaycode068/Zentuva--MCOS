import { Injectable } from '@nestjs/common';
import { Asset, AssetAcquisitionType, AssetCondition, AssetStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

const ASSET_CODE_PREFIX = 'AST';
const ASSET_CODE_SEQUENCE_LENGTH = 6;

export interface ListAssetsParams {
  status?: AssetStatus;
  condition?: AssetCondition;
  categoryId?: string;
  locationId?: string;
  custodianId?: string;
  acquisitionType?: AssetAcquisitionType;
  search?: string;
}

export interface CreateAssetData {
  organisationId: string;
  name: string;
  description?: string;
  categoryId: string;
  parentAssetId?: string;
  assetTag?: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  yearOfManufacture?: number;
  locationId?: string;
  custodianId?: string;
  acquisitionType?: AssetAcquisitionType;
  acquisitionDate?: Date;
  inServiceDate?: Date;
  acquisitionCost?: number;
  currency?: string;
  supplierId?: string;
  purchaseOrderId?: string;
  capitalProjectId?: string;
  warrantyStartDate?: Date;
  warrantyEndDate?: Date;
  warrantyProvider?: string;
  warrantyReference?: string;
  warrantyNotes?: string;
  usefulLifeMonths?: number;
  salvageValue?: number;
  notes?: string;
  idempotencyKey?: string;
  createdById: string;
}

export interface CreateAssetResult {
  asset: Asset;
  wasCreated: boolean;
}

export interface TransferAssetData {
  organisationId: string;
  assetId: string;
  newLocationId?: string;
  newCustodianId?: string;
  reason?: string;
  notes?: string;
  effectiveAt?: Date;
  performedById: string;
  idempotencyKey?: string;
}

export interface TransferAssetResult {
  asset: Asset;
  wasCreated: boolean;
}

export interface CapitalProjectRef {
  id: string;
  projectCode: string;
  name: string;
}

/**
 * Thin Prisma access for the `Asset` aggregate (Sprint 20, docs/domains/
 * assets.md). `assetCode` generation mirrors `CapitalProjectRepository.
 * generateProjectCode()` exactly (Sprint 18) — concurrency-safe inside the
 * create `$transaction`. The `findCapitalProjectRef()` method is a narrow,
 * documented, read-only reach directly into the `capitalProject` table —
 * `AssetsModule` never imports `FinanceModule` to get this (see
 * asset-independence.spec.ts and docs/domains/assets.md "Capital Project
 * Reference").
 */
@Injectable()
export class AssetRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<Asset | null> {
    return this.prisma.asset.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(organisationId: string, params: ListAssetsParams = {}): Promise<Asset[]> {
    return this.prisma.asset.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.condition ? { condition: params.condition } : {}),
        ...(params.categoryId ? { categoryId: params.categoryId } : {}),
        ...(params.locationId ? { locationId: params.locationId } : {}),
        ...(params.custodianId ? { custodianId: params.custodianId } : {}),
        ...(params.acquisitionType ? { acquisitionType: params.acquisitionType } : {}),
        ...(params.search
          ? {
              OR: [
                { assetCode: { contains: params.search, mode: 'insensitive' } },
                { assetTag: { contains: params.search, mode: 'insensitive' } },
                { name: { contains: params.search, mode: 'insensitive' } },
                { serialNumber: { contains: params.search, mode: 'insensitive' } },
                { manufacturer: { contains: params.search, mode: 'insensitive' } },
                { model: { contains: params.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findChildren(organisationId: string, parentAssetId: string): Promise<Asset[]> {
    return this.prisma.asset.findMany({
      where: { organisationId, parentAssetId },
      orderBy: { assetCode: 'asc' },
    });
  }

  async getParentId(id: string): Promise<string | null | undefined> {
    const row = await this.prisma.asset.findUnique({
      where: { id },
      select: { parentAssetId: true },
    });
    return row?.parentAssetId;
  }

  /** Narrow, read-only reach into Finance's `capitalProject` table — see
   *  this file's own doc comment. Never writes; independence-spec-proven. */
  async findCapitalProjectRef(
    organisationId: string,
    capitalProjectId: string,
  ): Promise<CapitalProjectRef | null> {
    return this.prisma.capitalProject.findFirst({
      where: { id: capitalProjectId, organisationId },
      select: { id: true, projectCode: true, name: true },
    });
  }

  async create(data: CreateAssetData): Promise<CreateAssetResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.asset.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { asset: existing, wasCreated: false };
        }
      }

      const assetCode = await this.generateAssetCode(tx, data.organisationId);

      const asset = await tx.asset.create({
        data: {
          organisationId: data.organisationId,
          assetCode,
          assetTag: data.assetTag,
          name: data.name,
          description: data.description,
          categoryId: data.categoryId,
          parentAssetId: data.parentAssetId,
          serialNumber: data.serialNumber,
          manufacturer: data.manufacturer,
          model: data.model,
          yearOfManufacture: data.yearOfManufacture,
          locationId: data.locationId,
          custodianId: data.custodianId,
          acquisitionType: data.acquisitionType ?? 'PURCHASE',
          acquisitionDate: data.acquisitionDate,
          inServiceDate: data.inServiceDate,
          acquisitionCost: data.acquisitionCost,
          currency: data.currency ?? 'NGN',
          supplierId: data.supplierId,
          purchaseOrderId: data.purchaseOrderId,
          capitalProjectId: data.capitalProjectId,
          warrantyStartDate: data.warrantyStartDate,
          warrantyEndDate: data.warrantyEndDate,
          warrantyProvider: data.warrantyProvider,
          warrantyReference: data.warrantyReference,
          warrantyNotes: data.warrantyNotes,
          usefulLifeMonths: data.usefulLifeMonths,
          salvageValue: data.salvageValue,
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
        },
      });

      return { asset, wasCreated: true };
    });
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.AssetUncheckedUpdateInput,
  ): Promise<Asset | null> {
    return this.updateMatching(organisationId, id, data);
  }

  setStatus(
    organisationId: string,
    id: string,
    data: Prisma.AssetUncheckedUpdateInput,
  ): Promise<Asset | null> {
    return this.updateMatching(organisationId, id, data);
  }

  setImage(
    organisationId: string,
    id: string,
    imageUrl: string | null,
    imageKey: string | null,
  ): Promise<Asset | null> {
    return this.updateMatching(organisationId, id, { imageUrl, imageKey });
  }

  /** Atomic: reads the asset's current location/custodian as "previous,"
   *  updates it to "new," and inserts one immutable `AssetMovement` row —
   *  all inside one transaction. Idempotency-check-first, the Sprint 9/10
   *  lesson. */
  async transfer(data: TransferAssetData): Promise<TransferAssetResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existingMovement = await tx.assetMovement.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existingMovement) {
          const asset = await tx.asset.findUniqueOrThrow({ where: { id: data.assetId } });
          return { asset, wasCreated: false };
        }
      }

      const current = await tx.asset.findFirstOrThrow({
        where: { id: data.assetId, organisationId: data.organisationId },
      });

      await tx.assetMovement.create({
        data: {
          organisationId: data.organisationId,
          assetId: data.assetId,
          previousLocationId: current.locationId,
          newLocationId: data.newLocationId ?? current.locationId,
          previousCustodianId: current.custodianId,
          newCustodianId: data.newCustodianId ?? current.custodianId,
          reason: data.reason,
          notes: data.notes,
          effectiveAt: data.effectiveAt ?? new Date(),
          performedById: data.performedById,
          idempotencyKey: data.idempotencyKey,
        },
      });

      const asset = await tx.asset.update({
        where: { id: data.assetId },
        data: {
          locationId: data.newLocationId ?? current.locationId,
          custodianId: data.newCustodianId ?? current.custodianId,
        },
      });

      return { asset, wasCreated: true };
    });
  }

  findMovements(organisationId: string, assetId: string) {
    return this.prisma.assetMovement.findMany({
      where: { organisationId, assetId },
      orderBy: { effectiveAt: 'desc' },
    });
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.AssetUncheckedUpdateInput,
  ): Promise<Asset | null> {
    const result = await this.prisma.asset.updateMany({ where: { id, organisationId }, data });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.asset.findUniqueOrThrow({ where: { id } });
  }

  private async generateAssetCode(
    tx: Prisma.TransactionClient,
    organisationId: string,
  ): Promise<string> {
    let sequence = 1;
    let candidate = this.formatAssetCode(sequence);
    while (
      await tx.asset.findUnique({
        where: { organisationId_assetCode: { organisationId, assetCode: candidate } },
        select: { id: true },
      })
    ) {
      sequence += 1;
      candidate = this.formatAssetCode(sequence);
    }
    return candidate;
  }

  private formatAssetCode(sequence: number): string {
    return `${ASSET_CODE_PREFIX}-${String(sequence).padStart(ASSET_CODE_SEQUENCE_LENGTH, '0')}`;
  }
}
