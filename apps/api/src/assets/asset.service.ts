import { BadRequestException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Asset, AssetStatus } from '@prisma/client';
import { CreateAssetInput, TransferAssetInput, UpdateAssetInput } from '@zentuva/validation';

import { UserService } from '../identity/user/user.service';
import { FILE_STORAGE, FileStorage } from '../identity/organisation/ports/file-storage.port';
import { PurchaseOrderRepository } from '../procurement/purchase-order/purchase-order.repository';
import { SupplierRepository } from '../suppliers/supplier/supplier.repository';
import { assertNoHierarchyCycle } from './hierarchy-guard';
import { AssetCategoryRepository } from './asset-category.repository';
import { AssetLocationRepository } from './asset-location.repository';
import {
  AssetRepository,
  CreateAssetResult,
  ListAssetsParams,
  TransferAssetResult,
} from './asset.repository';

const TERMINAL_STATUSES: AssetStatus[] = ['DISPOSED', 'RETIRED'];

export interface AssetTreeNode {
  asset: Asset;
  children: AssetTreeNode[];
}

/**
 * Domain service for the `Asset` aggregate (Sprint 20, docs/domains/
 * assets.md) — lifecycle guards, hierarchy cycle guards, transfer, and
 * document/photo uploads. Never posts a Journal Entry, never mutates
 * Supplier/PurchaseOrder/CapitalProject/User — every cross-domain
 * reference here is read-only (proven by asset-independence.spec.ts).
 */
@Injectable()
export class AssetService {
  constructor(
    private readonly assetRepository: AssetRepository,
    private readonly assetCategoryRepository: AssetCategoryRepository,
    private readonly assetLocationRepository: AssetLocationRepository,
    private readonly supplierRepository: SupplierRepository,
    private readonly purchaseOrderRepository: PurchaseOrderRepository,
    private readonly userService: UserService,
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStorage,
  ) {}

  async getById(organisationId: string, id: string): Promise<Asset> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListAssetsParams): Promise<Asset[]> {
    return this.assetRepository.findManyByOrganisation(organisationId, params);
  }

  async getChildren(organisationId: string, id: string): Promise<Asset[]> {
    await this.getByIdOrThrow(organisationId, id);
    return this.assetRepository.findChildren(organisationId, id);
  }

  async getTree(organisationId: string, id: string): Promise<AssetTreeNode> {
    const asset = await this.getByIdOrThrow(organisationId, id);
    return this.buildTree(organisationId, asset);
  }

  private async buildTree(organisationId: string, asset: Asset): Promise<AssetTreeNode> {
    const children = await this.assetRepository.findChildren(organisationId, asset.id);
    const childNodes = await Promise.all(
      children.map((child) => this.buildTree(organisationId, child)),
    );
    return { asset, children: childNodes };
  }

  async listCustodianCandidates(organisationId: string) {
    return this.userService.listByOrganisation(organisationId);
  }

  async create(
    organisationId: string,
    input: CreateAssetInput,
    actorUserId: string,
  ): Promise<CreateAssetResult> {
    await this.validateReferences(organisationId, input);

    return this.assetRepository.create({
      organisationId,
      name: input.name,
      description: input.description,
      categoryId: input.categoryId,
      parentAssetId: input.parentAssetId,
      assetTag: input.assetTag,
      serialNumber: input.serialNumber,
      manufacturer: input.manufacturer,
      model: input.model,
      yearOfManufacture: input.yearOfManufacture,
      locationId: input.locationId,
      custodianId: input.custodianId,
      acquisitionType: input.acquisitionType,
      acquisitionDate: input.acquisitionDate,
      inServiceDate: input.inServiceDate,
      acquisitionCost: input.acquisitionCost,
      currency: input.currency,
      supplierId: input.supplierId,
      purchaseOrderId: input.purchaseOrderId,
      capitalProjectId: input.capitalProjectId,
      warrantyStartDate: input.warrantyStartDate,
      warrantyEndDate: input.warrantyEndDate,
      warrantyProvider: input.warrantyProvider,
      warrantyReference: input.warrantyReference,
      warrantyNotes: input.warrantyNotes,
      usefulLifeMonths: input.usefulLifeMonths,
      salvageValue: input.salvageValue,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      createdById: actorUserId,
    });
  }

  async update(organisationId: string, id: string, input: UpdateAssetInput): Promise<Asset> {
    const asset = await this.getByIdOrThrow(organisationId, id);
    this.assertNotTerminal(asset);
    await this.validateReferences(organisationId, input, id);

    const updated = await this.assetRepository.update(organisationId, id, {
      name: input.name,
      description: input.description,
      categoryId: input.categoryId,
      parentAssetId: input.parentAssetId,
      assetTag: input.assetTag,
      condition: input.condition,
      serialNumber: input.serialNumber,
      manufacturer: input.manufacturer,
      model: input.model,
      yearOfManufacture: input.yearOfManufacture,
      custodianId: input.custodianId,
      acquisitionDate: input.acquisitionDate,
      inServiceDate: input.inServiceDate,
      acquisitionCost: input.acquisitionCost,
      supplierId: input.supplierId,
      purchaseOrderId: input.purchaseOrderId,
      capitalProjectId: input.capitalProjectId,
      warrantyStartDate: input.warrantyStartDate,
      warrantyEndDate: input.warrantyEndDate,
      warrantyProvider: input.warrantyProvider,
      warrantyReference: input.warrantyReference,
      warrantyNotes: input.warrantyNotes,
      usefulLifeMonths: input.usefulLifeMonths,
      salvageValue: input.salvageValue,
      notes: input.notes,
    });
    if (!updated) {
      throw new NotFoundException('Asset not found');
    }
    return updated;
  }

  async activate(
    organisationId: string,
    id: string,
  ): Promise<{ asset: Asset; transitioned: boolean }> {
    return this.transition(organisationId, id, ['DRAFT'], 'ACTIVE', { activatedAt: new Date() });
  }

  async commission(
    organisationId: string,
    id: string,
  ): Promise<{ asset: Asset; transitioned: boolean }> {
    return this.transition(organisationId, id, ['ACTIVE'], 'IN_SERVICE', {
      commissionedAt: new Date(),
      inServiceDate: new Date(),
    });
  }

  async startMaintenance(
    organisationId: string,
    id: string,
  ): Promise<{ asset: Asset; transitioned: boolean }> {
    return this.transition(organisationId, id, ['IN_SERVICE'], 'UNDER_MAINTENANCE', {});
  }

  async resumeService(
    organisationId: string,
    id: string,
  ): Promise<{ asset: Asset; transitioned: boolean }> {
    return this.transition(organisationId, id, ['UNDER_MAINTENANCE'], 'IN_SERVICE', {});
  }

  async takeOutOfService(
    organisationId: string,
    id: string,
  ): Promise<{ asset: Asset; transitioned: boolean }> {
    return this.transition(organisationId, id, ['IN_SERVICE'], 'OUT_OF_SERVICE', {});
  }

  async returnToService(
    organisationId: string,
    id: string,
  ): Promise<{ asset: Asset; transitioned: boolean }> {
    return this.transition(organisationId, id, ['OUT_OF_SERVICE'], 'IN_SERVICE', {});
  }

  async dispose(
    organisationId: string,
    id: string,
  ): Promise<{ asset: Asset; transitioned: boolean }> {
    return this.transition(
      organisationId,
      id,
      ['ACTIVE', 'IN_SERVICE', 'UNDER_MAINTENANCE', 'OUT_OF_SERVICE'],
      'DISPOSED',
      { disposedAt: new Date() },
    );
  }

  async retire(
    organisationId: string,
    id: string,
  ): Promise<{ asset: Asset; transitioned: boolean }> {
    return this.transition(
      organisationId,
      id,
      ['ACTIVE', 'IN_SERVICE', 'UNDER_MAINTENANCE', 'OUT_OF_SERVICE'],
      'RETIRED',
      { retiredAt: new Date() },
    );
  }

  async transfer(
    organisationId: string,
    id: string,
    input: TransferAssetInput,
    actorUserId: string,
  ): Promise<TransferAssetResult> {
    const asset = await this.getByIdOrThrow(organisationId, id);
    this.assertNotTerminal(asset);

    if (input.newLocationId) {
      const location = await this.assetLocationRepository.findById(
        organisationId,
        input.newLocationId,
      );
      if (!location) {
        throw new BadRequestException('Target location not found');
      }
    }
    if (input.newCustodianId) {
      const custodian = await this.userService.getById(organisationId, input.newCustodianId);
      if (!custodian) {
        throw new BadRequestException('Target custodian not found');
      }
    }

    return this.assetRepository.transfer({
      organisationId,
      assetId: id,
      newLocationId: input.newLocationId,
      newCustodianId: input.newCustodianId,
      reason: input.reason,
      notes: input.notes,
      effectiveAt: input.effectiveAt,
      performedById: actorUserId,
      idempotencyKey: input.idempotencyKey,
    });
  }

  listMovements(organisationId: string, id: string) {
    return this.assetRepository.findMovements(organisationId, id);
  }

  async setImage(
    organisationId: string,
    id: string,
    file: { mimeType: string; buffer: Buffer },
    _actorUserId: string,
  ): Promise<Asset> {
    const asset = await this.getByIdOrThrow(organisationId, id);
    const previousKey = asset.imageKey;

    const uploaded = await this.fileStorage.upload({
      organisationId,
      folder: 'assets',
      mimeType: file.mimeType,
      buffer: file.buffer,
    });

    const updated = await this.assetRepository.setImage(
      organisationId,
      id,
      uploaded.url,
      uploaded.key,
    );
    if (!updated) {
      throw new NotFoundException('Asset not found');
    }
    if (previousKey) {
      await this.fileStorage.delete(previousKey).catch(() => undefined);
    }
    return updated;
  }

  async removeImage(organisationId: string, id: string): Promise<Asset> {
    const asset = await this.getByIdOrThrow(organisationId, id);
    const key = asset.imageKey;
    const updated = await this.assetRepository.setImage(organisationId, id, null, null);
    if (!updated) {
      throw new NotFoundException('Asset not found');
    }
    if (key) {
      await this.fileStorage.delete(key).catch(() => undefined);
    }
    return updated;
  }

  private assertNotTerminal(asset: Asset): void {
    if (TERMINAL_STATUSES.includes(asset.status)) {
      throw new BadRequestException(
        `Cannot modify a ${asset.status.toLowerCase()} asset — its record is frozen`,
      );
    }
  }

  /** Non-terminal transitions are soft-idempotent (already-in-target-status
   *  returns unchanged, no error) — the established Sprint 17-19
   *  convention. Terminal transitions (`DISPOSED`/`RETIRED`) are
   *  hard-terminal instead: any further transition attempt, including a
   *  repeat dispose/retire, throws — a deliberate, documented deviation,
   *  per the brief's own explicit "disposing an already disposed asset"
   *  negative-test requirement (docs/domains/assets.md "Lifecycle"). */
  private async transition(
    organisationId: string,
    id: string,
    fromStatuses: AssetStatus[],
    toStatus: AssetStatus,
    extraData: Record<string, unknown>,
  ): Promise<{ asset: Asset; transitioned: boolean }> {
    const asset = await this.getByIdOrThrow(organisationId, id);

    // Terminal statuses are hard-terminal, never soft-idempotent (decision
    // #7) — this check fires unconditionally for an already-DISPOSED/
    // RETIRED asset, including a repeat dispose()/retire() call, before
    // any same-status soft-idempotency check below could apply.
    if (TERMINAL_STATUSES.includes(asset.status)) {
      throw new BadRequestException(
        `Cannot transition a ${asset.status.toLowerCase()} asset — it is a terminal state`,
      );
    }

    if (asset.status === toStatus) {
      return { asset, transitioned: false };
    }

    if (!fromStatuses.includes(asset.status)) {
      throw new BadRequestException(
        `Cannot move a ${asset.status.toLowerCase()} asset to ${toStatus.toLowerCase()}`,
      );
    }

    const updated = await this.assetRepository.setStatus(organisationId, id, {
      status: toStatus,
      ...extraData,
    });
    if (!updated) {
      throw new NotFoundException('Asset not found');
    }
    return { asset: updated, transitioned: true };
  }

  private async validateReferences(
    organisationId: string,
    input: {
      categoryId?: string;
      parentAssetId?: string | null;
      locationId?: string | null;
      custodianId?: string | null;
      supplierId?: string | null;
      purchaseOrderId?: string | null;
      capitalProjectId?: string | null;
    },
    selfId?: string,
  ): Promise<void> {
    if (input.categoryId) {
      const category = await this.assetCategoryRepository.findById(
        organisationId,
        input.categoryId,
      );
      if (!category) {
        throw new BadRequestException('Asset category not found');
      }
    }
    if (input.parentAssetId) {
      if (selfId && input.parentAssetId === selfId) {
        throw new BadRequestException('An asset cannot be its own parent');
      }
      const parent = await this.assetRepository.findById(organisationId, input.parentAssetId);
      if (!parent) {
        throw new BadRequestException('Parent asset not found');
      }
      if (selfId) {
        await assertNoHierarchyCycle('asset', selfId, input.parentAssetId, (candidateId) =>
          this.assetRepository.getParentId(candidateId),
        );
      }
    }
    if (input.locationId) {
      const location = await this.assetLocationRepository.findById(
        organisationId,
        input.locationId,
      );
      if (!location) {
        throw new BadRequestException('Asset location not found');
      }
    }
    if (input.custodianId) {
      const custodian = await this.userService.getById(organisationId, input.custodianId);
      if (!custodian) {
        throw new BadRequestException('Custodian not found');
      }
    }
    if (input.supplierId) {
      const supplier = await this.supplierRepository.findById(organisationId, input.supplierId);
      if (!supplier) {
        throw new BadRequestException('Supplier not found');
      }
    }
    if (input.purchaseOrderId) {
      const purchaseOrder = await this.purchaseOrderRepository.findById(
        organisationId,
        input.purchaseOrderId,
      );
      if (!purchaseOrder) {
        throw new BadRequestException('Purchase order not found');
      }
    }
    if (input.capitalProjectId) {
      const capitalProject = await this.assetRepository.findCapitalProjectRef(
        organisationId,
        input.capitalProjectId,
      );
      if (!capitalProject) {
        throw new BadRequestException('Capital project not found');
      }
    }
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<Asset> {
    const asset = await this.assetRepository.findById(organisationId, id);
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }
    return asset;
  }
}
