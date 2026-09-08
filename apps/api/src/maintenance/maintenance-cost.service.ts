import { BadRequestException, Injectable } from '@nestjs/common';
import { RecordMaintenanceCostInput } from '@zentuva/validation';

import { SupplierRepository } from '../suppliers/supplier/supplier.repository';
import { WorkOrderRepository } from './work-order.repository';
import {
  MaintenanceCostRepository,
  RecordMaintenanceCostResult,
} from './maintenance-cost.repository';

/** Domain service for `MaintenanceCost` (Sprint 21, docs/domains/maintenance.md). */
@Injectable()
export class MaintenanceCostService {
  constructor(
    private readonly maintenanceCostRepository: MaintenanceCostRepository,
    private readonly workOrderRepository: WorkOrderRepository,
    private readonly supplierRepository: SupplierRepository,
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

    return this.maintenanceCostRepository.record({
      organisationId,
      workOrderId: input.workOrderId,
      category: input.category,
      description: input.description,
      quantity: input.quantity,
      unitCost: input.unitCost,
      currency: input.currency,
      supplierId: input.supplierId,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey,
      recordedById: actorUserId,
    });
  }
}
