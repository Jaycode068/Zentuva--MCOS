import { BadRequestException, Injectable } from '@nestjs/common';
import { RecordPartUsageInput } from '@zentuva/validation';

import { ProductRepository } from '../catalogue/product/product.repository';
import { WorkOrderRepository } from './work-order.repository';
import {
  MaintenancePartUsageRepository,
  RecordPartUsageResult,
} from './maintenance-part-usage.repository';

/** Domain service for `MaintenancePartUsage` (Sprint 21, docs/domains/maintenance.md). */
@Injectable()
export class MaintenancePartUsageService {
  constructor(
    private readonly maintenancePartUsageRepository: MaintenancePartUsageRepository,
    private readonly workOrderRepository: WorkOrderRepository,
    private readonly productRepository: ProductRepository,
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
}
