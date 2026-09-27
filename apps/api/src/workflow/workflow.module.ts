import { Module } from '@nestjs/common';

import { AuthModule } from '../identity/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { RecruitmentModule } from '../hr/recruitment/recruitment.module';
import { PurchaseOrderModule } from '../procurement/purchase-order/purchase-order.module';
import { HiringRequestWorkflowHandler } from './handlers/hiring-request-workflow.handler';
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
 * Sprint 30 adds a second entry, `RecruitmentModule` (`apps/api/src/hr/
 * recruitment/`) for `HiringRequestWorkflowHandler` — the exact same
 * one-directional recipe: `RecruitmentModule` never imports `WorkflowModule`
 * and has no knowledge of it. `WORKFLOW_SUBJECT_HANDLERS`'s factory array now
 * has two entries; `WorkflowInstanceService`/`WorkflowEligibilityService`/
 * every controller in this module needed ZERO changes to support it — a
 * future domain integration (Supplier Payment, Sales Order, ...) follows the
 * identical pattern: its own handler class, its own module import, and one
 * more entry in this factory's array.
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
  imports: [IdentityModule, AuthModule, PurchaseOrderModule, RecruitmentModule],
  controllers: [WorkflowDefinitionController, WorkflowInstanceController],
  providers: [
    WorkflowDefinitionRepository,
    WorkflowDefinitionService,
    WorkflowInstanceRepository,
    WorkflowInstanceService,
    WorkflowEligibilityService,
    WorkflowEventRepository,
    PurchaseOrderWorkflowHandler,
    HiringRequestWorkflowHandler,
    {
      provide: WORKFLOW_SUBJECT_HANDLERS,
      useFactory: (
        purchaseOrderHandler: PurchaseOrderWorkflowHandler,
        hiringRequestHandler: HiringRequestWorkflowHandler,
      ) => [purchaseOrderHandler, hiringRequestHandler],
      inject: [PurchaseOrderWorkflowHandler, HiringRequestWorkflowHandler],
    },
  ],
  exports: [WorkflowEligibilityService, WorkflowDefinitionService, WORKFLOW_SUBJECT_HANDLERS],
})
export class WorkflowModule {}
