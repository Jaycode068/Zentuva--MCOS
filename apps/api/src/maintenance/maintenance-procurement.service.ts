import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CreateProcurementRequirementInput,
  LinkProcurementRequirementInput,
} from '@zentuva/validation';

import { PurchaseOrderRepository } from '../procurement/purchase-order/purchase-order.repository';
import { SupplierRepository } from '../suppliers/supplier/supplier.repository';
import { WorkOrderRepository } from './work-order.repository';
import {
  CreateProcurementRequirementResult,
  MaintenanceProcurementRepository,
  ProcurementRequirementNotFoundError,
  ProcurementRequirementStatusConflictError,
} from './maintenance-procurement.repository';

/**
 * Domain service for `MaintenanceProcurementRequirement` (Sprint 22,
 * docs/domains/maintenance-integration.md "Procurement Integration").
 * `PurchaseOrderRepository`/`SupplierRepository` are both injected
 * read-only — Maintenance never creates or updates a Purchase Order or a
 * Supplier through this service, only validates that a given id already
 * exists in this tenant before recording a plain reference to it.
 */
@Injectable()
export class MaintenanceProcurementService {
  constructor(
    private readonly maintenanceProcurementRepository: MaintenanceProcurementRepository,
    private readonly workOrderRepository: WorkOrderRepository,
    private readonly purchaseOrderRepository: PurchaseOrderRepository,
    private readonly supplierRepository: SupplierRepository,
  ) {}

  list(organisationId: string, workOrderId: string) {
    return this.maintenanceProcurementRepository.findManyByWorkOrder(organisationId, workOrderId);
  }

  async create(
    organisationId: string,
    workOrderId: string,
    input: CreateProcurementRequirementInput,
    actorUserId: string,
  ): Promise<CreateProcurementRequirementResult> {
    const workOrder = await this.workOrderRepository.findById(organisationId, workOrderId);
    if (!workOrder) {
      throw new BadRequestException('Work order not found');
    }
    if (input.supplierId) {
      const supplier = await this.supplierRepository.findById(organisationId, input.supplierId);
      if (!supplier) {
        throw new BadRequestException('Supplier not found');
      }
    }

    return this.maintenanceProcurementRepository.create({
      organisationId,
      workOrderId,
      description: input.description,
      estimatedCost: input.estimatedCost,
      supplierId: input.supplierId,
      idempotencyKey: input.idempotencyKey,
      createdById: actorUserId,
    });
  }

  async link(
    organisationId: string,
    requirementId: string,
    input: LinkProcurementRequirementInput,
  ) {
    const purchaseOrder = await this.purchaseOrderRepository.findById(
      organisationId,
      input.purchaseOrderId,
    );
    if (!purchaseOrder) {
      throw new BadRequestException('Purchase order not found');
    }

    try {
      return await this.maintenanceProcurementRepository.link({
        organisationId,
        requirementId,
        purchaseOrderId: input.purchaseOrderId,
      });
    } catch (error) {
      if (error instanceof ProcurementRequirementNotFoundError) {
        throw new BadRequestException('Procurement requirement not found');
      }
      if (error instanceof ProcurementRequirementStatusConflictError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async cancel(organisationId: string, requirementId: string) {
    try {
      return await this.maintenanceProcurementRepository.cancel(organisationId, requirementId);
    } catch (error) {
      if (error instanceof ProcurementRequirementNotFoundError) {
        throw new BadRequestException('Procurement requirement not found');
      }
      if (error instanceof ProcurementRequirementStatusConflictError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async getApSummary(organisationId: string, requirementId: string) {
    const requirement = await this.maintenanceProcurementRepository.findById(
      organisationId,
      requirementId,
    );
    if (!requirement) {
      throw new BadRequestException('Procurement requirement not found');
    }
    if (!requirement.purchaseOrderId) {
      return { applicable: false as const, reason: 'No purchase order linked yet' };
    }
    const summary = await this.maintenanceProcurementRepository.getApSummaryForPurchaseOrder(
      organisationId,
      requirement.purchaseOrderId,
    );
    return { applicable: true as const, purchaseOrderId: requirement.purchaseOrderId, ...summary };
  }
}
