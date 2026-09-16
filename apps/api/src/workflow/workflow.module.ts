import { Module } from '@nestjs/common';

import { AuthModule } from '../identity/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { PurchaseOrderModule } from '../procurement/purchase-order/purchase-order.module';
import { PurchaseOrderWorkflowHandler } from './handlers/purchase-order-workflow.handler';
import { WorkflowDefinitionController } from './workflow-definition.controller';
import { WorkflowDefinitionRepository } from './workflow-definition.repository';
import { WorkflowDefinitionService } from './workflow-definition.service';
import { WorkflowEligibilityService } from './workflow-eligibility.service';
import { WorkflowEventRepository } from './workflow-event.repository';
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
 *
 * Sprint 27 — `NotificationsModule` imports this module read-only (the same
 * one-directional pattern as `PurchaseOrderModule` above, just in the other
 * direction: a downstream CONSUMER of Workflow rather than a domain Workflow
 * integrates INTO). It reuses `WorkflowEligibilityService`/`WorkflowDefinitionService`
 * (recipient resolution must ask the exact same "is this user eligible" question
 * Workflow itself asks — duplicating that logic would be the real violation of "don't
 * embed workflow business logic elsewhere") and `WORKFLOW_SUBJECT_HANDLERS` (to
 * produce a human-readable notification body via each handler's existing
 * `describe()`). `WorkflowModule` itself imports nothing new and has zero awareness
 * of `NotificationsModule` — the dependency points one way only, exactly like every
 * other cross-domain boundary in this codebase.
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
    WorkflowEventRepository,
    PurchaseOrderWorkflowHandler,
    {
      provide: WORKFLOW_SUBJECT_HANDLERS,
      useFactory: (purchaseOrderHandler: PurchaseOrderWorkflowHandler) => [purchaseOrderHandler],
      inject: [PurchaseOrderWorkflowHandler],
    },
  ],
  exports: [WorkflowEligibilityService, WorkflowDefinitionService, WORKFLOW_SUBJECT_HANDLERS],
})
export class WorkflowModule {}
