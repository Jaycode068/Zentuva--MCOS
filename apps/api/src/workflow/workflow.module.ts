import { Module } from '@nestjs/common';

import { AuthModule } from '../identity/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { PurchaseOrderModule } from '../procurement/purchase-order/purchase-order.module';
import { PurchaseOrderWorkflowHandler } from './handlers/purchase-order-workflow.handler';
import { WorkflowDefinitionController } from './workflow-definition.controller';
import { WorkflowDefinitionRepository } from './workflow-definition.repository';
import { WorkflowDefinitionService } from './workflow-definition.service';
import { WorkflowEligibilityService } from './workflow-eligibility.service';
import { WorkflowInstanceController } from './workflow-instance.controller';
import { WorkflowInstanceRepository } from './workflow-instance.repository';
import { WorkflowInstanceService } from './workflow-instance.service';
import { WORKFLOW_SUBJECT_HANDLERS } from './workflow-subject-handler';

/**
 * Workflow & Approval HTTP surface (Sprint 26, docs/domains/workflow.md). Imports
 * `IdentityModule` for `EffectiveAccessResolver`/`ScopeEvaluator`/`UserService` (the
 * eligibility engine reuses Access Control entirely rather than duplicating permission
 * resolution — workflow.md §2.2) and `AuthModule` for the guards.
 *
 * Imports `PurchaseOrderModule` — the ONE domain-integration exception, matching
 * `AccessControlModule`'s read-only `HrModule` import (Sprint 25) and
 * `InventoryModule`'s existing `PurchaseOrderRepository` consumption (Sprint 4.4):
 * one-directional only. `ProcurementModule` never imports `WorkflowModule` and has no
 * knowledge of it — `PurchaseOrderWorkflowHandler` lives entirely on this side of the
 * boundary, calling into `PurchaseOrderRepository`'s already-exported surface, the same
 * way Inventory already does for goods receipt validation.
 *
 * `WORKFLOW_SUBJECT_HANDLERS` is a plain array-of-one today
 * (`PurchaseOrderWorkflowHandler`) — a future domain integration (Supplier Payment,
 * Sales Order, ...) adds its own handler class and one more entry to this factory's
 * array, importing that domain's module the same way, without touching
 * `WorkflowInstanceService` at all.
 */
@Module({
  imports: [IdentityModule, AuthModule, PurchaseOrderModule],
  controllers: [WorkflowDefinitionController, WorkflowInstanceController],
  providers: [
    WorkflowDefinitionRepository,
    WorkflowDefinitionService,
    WorkflowInstanceRepository,
    WorkflowInstanceService,
    WorkflowEligibilityService,
    PurchaseOrderWorkflowHandler,
    {
      provide: WORKFLOW_SUBJECT_HANDLERS,
      useFactory: (purchaseOrderHandler: PurchaseOrderWorkflowHandler) => [purchaseOrderHandler],
      inject: [PurchaseOrderWorkflowHandler],
    },
  ],
})
export class WorkflowModule {}
