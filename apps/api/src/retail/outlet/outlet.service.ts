import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CollectionPointStatus, Outlet, OutletPhoto, OutletStatus } from '@prisma/client';
import {
  AddOutletPhotosInput,
  CreateOutletInput,
  UpdateCollectionPointConfigInput,
  UpdateOutletInput,
} from '@zentuva/validation';

import { FILE_STORAGE, FileStorage } from '../../identity/organisation/ports/file-storage.port';
import { UserService } from '../../identity/user/user.service';
import { InventoryLocationRepository } from '../../inventory/inventory-location.repository';
import { CustomerRepository } from '../customer/customer.repository';
import { TerritoryRepository } from '../territory/territory.repository';
import { ListOutletsParams, OutletRepository, OutletWithRelations } from './outlet.repository';
import { OutletPhotoRepository } from './outlet-photo.repository';

const OUTLET_CODE_PREFIX = 'OUT';
const OUTLET_CODE_SEQUENCE_LENGTH = 6;

export interface OutletPhotoFile {
  mimeType: string;
  buffer: Buffer;
}

/**
 * Domain service for the `Outlet` aggregate (Sprint 4.8, docs/domains/outlets.md) — the
 * physical place of business, distinct from the commercial `Customer` account. Validates
 * `customerId` (always) and `territoryId` (when supplied) via the referencing domain's
 * own tenant-scoped `findById`, same pattern as `CustomerService.assertTerritoryExists`.
 *
 * Photo handling is additive on top of the existing single-file `FileStorage` port
 * (`upload()`/`delete()` unchanged) — `addPhotos` calls `upload()` once per file and
 * writes one `OutletPhoto` row per result.
 */
@Injectable()
export class OutletService {
  constructor(
    private readonly outletRepository: OutletRepository,
    private readonly outletPhotoRepository: OutletPhotoRepository,
    private readonly customerRepository: CustomerRepository,
    private readonly territoryRepository: TerritoryRepository,
    private readonly userService: UserService,
    private readonly inventoryLocationRepository: InventoryLocationRepository,
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStorage,
  ) {}

  getById(organisationId: string, id: string): Promise<OutletWithRelations | null> {
    return this.outletRepository.findByIdWithRelations(organisationId, id);
  }

  list(organisationId: string, params?: ListOutletsParams): Promise<OutletWithRelations[]> {
    return this.outletRepository.findManyByOrganisation(organisationId, params);
  }

  /** New outlets always start `ACTIVE`. Coordinates are optional and never required at
   *  creation (brief §8: "Do not require coordinates during onboarding"). */
  async create(
    organisationId: string,
    input: CreateOutletInput,
    actorUserId: string,
  ): Promise<OutletWithRelations> {
    await this.assertCustomerExists(organisationId, input.customerId);
    if (input.territoryId) {
      await this.assertTerritoryExists(organisationId, input.territoryId);
    }
    const outletCode = await this.generateUniqueCode();

    return this.outletRepository.create({
      organisation: { connect: { id: organisationId } },
      customer: { connect: { id: input.customerId } },
      outletCode,
      outletType: input.outletType,
      name: input.name,
      contactPersonName: input.contactPersonName,
      phoneNumber: input.phoneNumber,
      address: input.address,
      city: input.city,
      state: input.state,
      country: input.country,
      latitude: input.latitude,
      longitude: input.longitude,
      notes: input.notes,
      status: OutletStatus.ACTIVE,
      createdById: actorUserId,
      updatedById: actorUserId,
      ...(input.territoryId ? { territory: { connect: { id: input.territoryId } } } : {}),
    });
  }

  /** Partial update — `customerId`/`outletCode` are never accepted here. An outlet's
   *  owning customer is immutable after creation: moving it would rewrite which account
   *  every past Sales Order attributed the outlet to. */
  async update(
    organisationId: string,
    id: string,
    input: UpdateOutletInput,
    actorUserId: string,
  ): Promise<OutletWithRelations> {
    await this.getByIdOrThrow(organisationId, id);
    if (input.territoryId) {
      await this.assertTerritoryExists(organisationId, input.territoryId);
    }

    const updated = await this.outletRepository.update(organisationId, id, {
      outletType: input.outletType,
      name: input.name,
      contactPersonName: input.contactPersonName,
      phoneNumber: input.phoneNumber,
      address: input.address,
      city: input.city,
      state: input.state,
      country: input.country,
      latitude: input.latitude,
      longitude: input.longitude,
      notes: input.notes,
      updatedById: actorUserId,
      ...(input.territoryId !== undefined ? { territoryId: input.territoryId } : {}),
    });
    if (!updated) {
      throw new NotFoundException('Outlet not found');
    }
    return updated;
  }

  async activate(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<OutletWithRelations> {
    const outlet = await this.getByIdOrThrow(organisationId, id);
    if (outlet.status === OutletStatus.ACTIVE) {
      throw new BadRequestException('Outlet is already active');
    }
    return this.setStatus(organisationId, id, OutletStatus.ACTIVE, actorUserId);
  }

  async deactivate(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<OutletWithRelations> {
    const outlet = await this.getByIdOrThrow(organisationId, id);
    if (outlet.status === OutletStatus.INACTIVE) {
      throw new BadRequestException('Outlet is already inactive');
    }
    return this.setStatus(organisationId, id, OutletStatus.INACTIVE, actorUserId);
  }

  /**
   * Sprint 36 — Collection Point capability (docs/domains/d2c.md "Collection Point
   * Eligibility"). A CAPABILITY of this existing Outlet, never a parallel entity — enabling
   * it never touches `outletType`, credit terms, distributor relationships, or any other
   * B2B field. Eligibility, the actual rules implemented (nothing beyond what the
   * existing architecture already supports):
   *
   * 1. The outlet must belong to the caller's own tenant (enforced by `getByIdOrThrow`'s
   *    tenant-scoped lookup — a cross-tenant id is indistinguishable from a nonexistent
   *    one, same as every other domain in this codebase).
   * 2. `Outlet.status` must be `ACTIVE` — an `INACTIVE` outlet cannot be enabled (brief
   *    "COLLECTION POINT STATUS AND EXISTING OUTLET STATUS").
   * 3. `Outlet.territoryId` must be set — a Collection Point's geographic context is the
   *    outlet's own existing territory relationship (brief: "Do not introduce another
   *    territory relationship"); with none set, a future consumer-discovery query
   *    (Sprint 37/38) would have no territory to match against at all.
   */
  async enableCollectionPoint(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<OutletWithRelations> {
    const outlet = await this.getByIdOrThrow(organisationId, id);
    if (outlet.collectionPointStatus === CollectionPointStatus.ENABLED) {
      throw new BadRequestException('Collection Point is already enabled for this outlet');
    }
    if (outlet.status !== OutletStatus.ACTIVE) {
      throw new BadRequestException('Outlet must be active to enable Collection Point');
    }
    if (!outlet.territoryId) {
      throw new BadRequestException(
        'Outlet must have a territory assigned to enable Collection Point',
      );
    }
    return this.setCollectionPointStatus(
      organisationId,
      id,
      CollectionPointStatus.ENABLED,
      actorUserId,
    );
  }

  /**
   * Reversible, never destructive (brief "DISABLING A COLLECTION POINT"): configuration
   * (`collectionPointResponsibleUserId`/`.OperatingHours`) is left untouched so
   * re-enabling later needs no re-entry, and no historical `SalesOrder`/`Payment` row
   * referencing this outlet is touched — there is nothing to migrate or reassign this
   * sprint since D2C fulfilment from a Collection Point does not exist yet (Sprint 37).
   */
  async disableCollectionPoint(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<OutletWithRelations> {
    const outlet = await this.getByIdOrThrow(organisationId, id);
    if (outlet.collectionPointStatus === CollectionPointStatus.DISABLED) {
      throw new BadRequestException('Collection Point is already disabled for this outlet');
    }
    return this.setCollectionPointStatus(
      organisationId,
      id,
      CollectionPointStatus.DISABLED,
      actorUserId,
    );
  }

  /**
   * Configuration is intentionally editable whether the capability is currently enabled
   * or disabled — an admin may pre-configure a responsible representative/operating hours
   * before the first enable, or adjust them afterward, matching how `update()` already
   * works independently of `activate`/`deactivate`. `responsibleUserId` (when supplied,
   * including explicitly clearing it via `null`) is validated tenant-scoped and `ACTIVE`
   * — never trusted from the client (brief "VALIDATION").
   */
  async updateCollectionPointConfig(
    organisationId: string,
    id: string,
    input: UpdateCollectionPointConfigInput,
    actorUserId: string,
  ): Promise<OutletWithRelations> {
    await this.getByIdOrThrow(organisationId, id);
    if (input.responsibleUserId) {
      await this.assertValidResponsibleUser(organisationId, input.responsibleUserId);
    }
    if (input.inventoryLocationId) {
      await this.assertValidInventoryLocation(organisationId, input.inventoryLocationId);
    }

    const updated = await this.outletRepository.update(organisationId, id, {
      updatedById: actorUserId,
      ...(input.responsibleUserId !== undefined
        ? { collectionPointResponsibleUserId: input.responsibleUserId }
        : {}),
      ...(input.operatingHours !== undefined
        ? { collectionPointOperatingHours: input.operatingHours }
        : {}),
      ...(input.inventoryLocationId !== undefined
        ? { inventoryLocationId: input.inventoryLocationId }
        : {}),
    });
    if (!updated) {
      throw new NotFoundException('Outlet not found');
    }
    return updated;
  }

  private async setCollectionPointStatus(
    organisationId: string,
    id: string,
    collectionPointStatus: CollectionPointStatus,
    actorUserId: string,
  ): Promise<OutletWithRelations> {
    const updated = await this.outletRepository.update(organisationId, id, {
      collectionPointStatus,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Outlet not found');
    }
    return updated;
  }

  private async assertValidResponsibleUser(organisationId: string, userId: string): Promise<void> {
    const user = await this.userService.getById(organisationId, userId);
    if (!user) {
      throw new BadRequestException(
        'Responsible representative must be a user in this organisation',
      );
    }
    if (user.status !== 'ACTIVE') {
      throw new BadRequestException('Responsible representative must be an active user');
    }
  }

  /** Sprint 37 — the audited Outlet<->InventoryLocation bridge
   *  (docs/domains/d2c.md "Inventory Integration Decision"). Tenant-scoped, same
   *  convention as `assertTerritoryExists`; does not require `ACTIVE` status here (an
   *  admin may configure the link before the location itself is activated) — eligibility
   *  for actually ASSIGNING fulfilment work checks the location's live status instead
   *  (`CollectionPointFulfillmentService`). */
  private async assertValidInventoryLocation(
    organisationId: string,
    inventoryLocationId: string,
  ): Promise<void> {
    const location = await this.inventoryLocationRepository.findById(
      organisationId,
      inventoryLocationId,
    );
    if (!location) {
      throw new BadRequestException('Inventory location not found');
    }
  }

  /**
   * Uploads each file via the existing single-file `FileStorage` port and writes one
   * `OutletPhoto` row per result. Asserts the outlet exists first so a cross-tenant
   * request fails before any file is ever uploaded. On partial failure (one upload
   * succeeds, a later one throws), best-effort deletes the already-uploaded files so
   * nothing orphaned is left in storage — same `.catch(() => undefined)` convention as
   * `ProductService.setImage`'s previous-file cleanup.
   */
  async addPhotos(
    organisationId: string,
    outletId: string,
    files: OutletPhotoFile[],
    input: AddOutletPhotosInput,
    actorUserId: string,
  ): Promise<OutletPhoto[]> {
    await this.getByIdOrThrow(organisationId, outletId);

    const uploadedKeys: string[] = [];
    try {
      const photos: OutletPhoto[] = [];
      for (const file of files) {
        const uploaded = await this.fileStorage.upload({
          organisationId,
          folder: 'outlet-photos',
          mimeType: file.mimeType,
          buffer: file.buffer,
        });
        uploadedKeys.push(uploaded.key);
        const photo = await this.outletPhotoRepository.addPhoto({
          organisation: { connect: { id: organisationId } },
          outlet: { connect: { id: outletId } },
          url: uploaded.url,
          key: uploaded.key,
          photoType: input.photoType,
          caption: input.caption,
          createdById: actorUserId,
        });
        photos.push(photo);
      }
      return photos;
    } catch (error) {
      await Promise.all(
        uploadedKeys.map((key) => this.fileStorage.delete(key).catch(() => undefined)),
      );
      throw error;
    }
  }

  /** `DELETE /:id/photos/:photoId` — tenant-scoped delete, then best-effort removes the
   *  underlying stored file. */
  async removePhoto(organisationId: string, outletId: string, photoId: string): Promise<void> {
    const photo = await this.outletPhotoRepository.removePhoto(organisationId, outletId, photoId);
    if (!photo) {
      throw new NotFoundException('Outlet photo not found');
    }
    await this.fileStorage.delete(photo.key).catch(() => undefined);
  }

  private async setStatus(
    organisationId: string,
    id: string,
    status: OutletStatus,
    actorUserId: string,
  ): Promise<OutletWithRelations> {
    const updated = await this.outletRepository.update(organisationId, id, {
      status,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Outlet not found');
    }
    return updated;
  }

  private async assertCustomerExists(organisationId: string, customerId: string): Promise<void> {
    const customer = await this.customerRepository.findById(organisationId, customerId);
    if (!customer) {
      throw new BadRequestException('Customer not found');
    }
  }

  private async assertTerritoryExists(organisationId: string, territoryId: string): Promise<void> {
    const territory = await this.territoryRepository.findById(organisationId, territoryId);
    if (!territory) {
      throw new BadRequestException('Territory not found');
    }
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<Outlet> {
    const outlet = await this.outletRepository.findById(organisationId, id);
    if (!outlet) {
      throw new NotFoundException('Outlet not found');
    }
    return outlet;
  }

  /** `OUT-000001`, `OUT-000002`, ... — globally unique, same collision-avoidance loop as
   *  every other auto-numbered entity in this codebase. */
  private async generateUniqueCode(): Promise<string> {
    let sequence = 1;
    let candidate = formatOutletCode(sequence);
    while (await this.outletRepository.existsByCode(candidate)) {
      sequence += 1;
      candidate = formatOutletCode(sequence);
    }
    return candidate;
  }
}

function formatOutletCode(sequence: number): string {
  return `${OUTLET_CODE_PREFIX}-${String(sequence).padStart(OUTLET_CODE_SEQUENCE_LENGTH, '0')}`;
}
