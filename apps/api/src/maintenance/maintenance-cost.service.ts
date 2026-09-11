import { BadRequestException, Injectable } from '@nestjs/common';
import { RecordMaintenanceCostInput } from '@zentuva/validation';

import { SupplierRepository } from '../suppliers/supplier/supplier.repository';
import {
  CostCentreNotFoundError,
  MaintenanceAnalyticsService,
} from './maintenance-analytics.service';
import { WorkOrderRepository } from './work-order.repository';
import {
  MaintenanceCostRepository,
  RecordMaintenanceCostResult,
} from './maintenance-cost.repository';

/**
 * Domain service for `MaintenanceCost` (Sprint 21, docs/domains/
 * maintenance.md; extended Sprint 22, docs/domains/
 * maintenance-integration.md "Budget Integration" — `costCentreId`
 * validation delegates to `MaintenanceAnalyticsService.
 * assertCostCentreExists()`, the file that owns the narrow read-only
 * reach into Budgeting's `CostCentre` table).
 */
@Injectable()
export class MaintenanceCostService {
  constructor(
    private readonly maintenanceCostRepository: MaintenanceCostRepository,
    private readonly workOrderRepository: WorkOrderRepository,
    private readonly supplierRepository: SupplierRepository,
    private readonly maintenanceAnalyticsService: MaintenanceAnalyticsService,
  ) {}

  list(organisationId: string, workOrderId: string) {
    return this.maintenanceCostRepository.findManyByWorkOrder(organisationId, workOrderId);
  }

  async record(
    organisationId: string,
    input: RecordMaintenanceCostInput,
    actorUserId: string,
  ): Promise<RecordMaintenanceCostResult> {
    const workOrder = await this.workOrderRepository.findById(organisationId, input.workOrderId);
    if (!workOrder) {
      throw new BadRequestException('Work order not found');
    }
    if (input.supplierId) {
      const supplier = await this.supplierRepository.findById(organisationId, input.supplierId);
      if (!supplier) {
        throw new BadRequestException('Supplier not found');
      }
    }
    if (input.costCentreId) {
      try {
        await this.maintenanceAnalyticsService.assertCostCentreExists(
          organisationId,
          input.costCentreId,
        );
      } catch (error) {
        if (error instanceof CostCentreNotFoundError) {
          throw new BadRequestException(error.message);
        }
        throw error;
      }
    }

    return this.maintenanceCostRepository.record({
      organisationId,
      workOrderId: input.workOrderId,
      category: input.category,
      description: input.description,
      quantity: input.quantity,
      unitCost: input.unitCost,
      currency: input.currency,
      supplierId: input.supplierId,
      costCentreId: input.costCentreId,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey,
      recordedById: actorUserId,
    });
  }
}
