import { BadRequestException, Injectable } from '@nestjs/common';
import { MaintenancePartUsage } from '@prisma/client';
import {
  CancelPartUsageInput,
  IssuePartUsageInput,
  RecordPartUsageInput,
} from '@zentuva/validation';

import { ProductRepository } from '../catalogue/product/product.repository';
import { InventoryLocationRepository } from '../inventory/inventory-location.repository';
import { WorkOrderRepository } from './work-order.repository';
import {
  InsufficientStockError,
  IssuePartUsageResult,
  MaintenancePartUsageRepository,
  PartUsageNotFoundError,
  PartUsageStatusConflictError,
  RecordPartUsageResult,
} from './maintenance-part-usage.repository';

/**
 * Domain service for `MaintenancePartUsage` (Sprint 21, docs/domains/
 * maintenance.md; extended Sprint 22, docs/domains/
 * maintenance-integration.md "Inventory Integration"). `InventoryLocationRepository`
 * is injected read-only — the only inventory-domain dependency this file
 * needs, to validate `locationId` belongs to this tenant before `issue()`
 * ever reaches the repository's own atomic transaction. Never imports
 * `InventoryService`/`InventoryModule` itself.
 */
@Injectable()
export class MaintenancePartUsageService {
  constructor(
    private readonly maintenancePartUsageRepository: MaintenancePartUsageRepository,
    private readonly workOrderRepository: WorkOrderRepository,
    private readonly productRepository: ProductRepository,
    private readonly inventoryLocationRepository: InventoryLocationRepository,
  ) {}

  list(organisationId: string, workOrderId: string) {
    return this.maintenancePartUsageRepository.findManyByWorkOrder(organisationId, workOrderId);
  }

  async record(
    organisationId: string,
    input: RecordPartUsageInput,
    actorUserId: string,
  ): Promise<RecordPartUsageResult> {
    const workOrder = await this.workOrderRepository.findById(organisationId, input.workOrderId);
    if (!workOrder) {
      throw new BadRequestException('Work order not found');
    }
    const product = await this.productRepository.findById(organisationId, input.productId);
    if (!product) {
      throw new BadRequestException('Product not found');
    }

    return this.maintenancePartUsageRepository.record({
      organisationId,
      workOrderId: input.workOrderId,
      productId: input.productId,
      quantity: input.quantity,
      unitOfMeasure: product.unit,
      usageType: input.usageType,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      recordedById: actorUserId,
    });
  }

  async issue(
    organisationId: string,
    partUsageId: string,
    input: IssuePartUsageInput,
    actorUserId: string,
  ): Promise<IssuePartUsageResult> {
    const location = await this.inventoryLocationRepository.findById(
      organisationId,
      input.locationId,
    );
    if (!location) {
      throw new BadRequestException('Inventory location not found');
    }

    try {
      return await this.maintenancePartUsageRepository.issue({
        organisationId,
        partUsageId,
        locationId: input.locationId,
        issueIdempotencyKey: input.issueIdempotencyKey,
        issuedById: actorUserId,
      });
    } catch (error) {
      if (error instanceof PartUsageNotFoundError) {
        throw new BadRequestException('Maintenance part usage not found');
      }
      if (error instanceof PartUsageStatusConflictError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof InsufficientStockError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async cancel(
    organisationId: string,
    partUsageId: string,
    _input: CancelPartUsageInput,
    actorUserId: string,
  ): Promise<{ partUsage: MaintenancePartUsage }> {
    try {
      return await this.maintenancePartUsageRepository.cancel({
        organisationId,
        partUsageId,
        cancelledById: actorUserId,
      });
    } catch (error) {
      if (error instanceof PartUsageNotFoundError) {
        throw new BadRequestException('Maintenance part usage not found');
      }
      if (error instanceof PartUsageStatusConflictError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
