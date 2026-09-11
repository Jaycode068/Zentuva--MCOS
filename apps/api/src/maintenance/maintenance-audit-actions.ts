/**
 * Audit action strings for Sprint 21's Maintenance Management Foundation
 * (docs/domains/maintenance.md) — `MaintenanceType`, `MaintenancePlan`,
 * `MaintenanceSchedule`, `MaintenanceRequest`, `WorkOrder`/
 * `WorkOrderTask`, `AssetDowntime`, `MaintenanceCost`,
 * `MaintenancePartUsage`, `MaintenanceDocument`. Same `<entity>.<event>`
 * naming convention as `asset-audit-actions.ts`.
 */
export const MAINTENANCE_AUDIT_ACTIONS = {
  MAINTENANCE_TYPE_CREATED: 'maintenance-type.created',
  MAINTENANCE_TYPE_UPDATED: 'maintenance-type.updated',
  MAINTENANCE_PLAN_CREATED: 'maintenance.plan.created',
  MAINTENANCE_PLAN_UPDATED: 'maintenance.plan.updated',
  MAINTENANCE_SCHEDULE_CREATED: 'maintenance.schedule.created',
  MAINTENANCE_SCHEDULE_UPDATED: 'maintenance.schedule.updated',
  MAINTENANCE_SCHEDULE_GENERATED: 'maintenance.schedule.generated',
  MAINTENANCE_REQUEST_CREATED: 'maintenance.request.created',
  MAINTENANCE_REQUEST_UPDATED: 'maintenance.request.updated',
  MAINTENANCE_REQUEST_APPROVED: 'maintenance.request.approved',
  MAINTENANCE_REQUEST_REJECTED: 'maintenance.request.rejected',
  MAINTENANCE_REQUEST_CANCELLED: 'maintenance.request.cancelled',
  MAINTENANCE_REQUEST_CONVERTED: 'maintenance.request.converted',
  WORK_ORDER_CREATED: 'maintenance.work_order.created',
  WORK_ORDER_UPDATED: 'maintenance.work_order.updated',
  WORK_ORDER_ASSIGNED: 'maintenance.work_order.assigned',
  WORK_ORDER_STARTED: 'maintenance.work_order.started',
  WORK_ORDER_ON_HOLD: 'maintenance.work_order.on_hold',
  WORK_ORDER_RESUMED: 'maintenance.work_order.resumed',
  WORK_ORDER_COMPLETED: 'maintenance.work_order.completed',
  WORK_ORDER_CANCELLED: 'maintenance.work_order.cancelled',
  WORK_ORDER_TASK_UPDATED: 'maintenance.task.updated',
  WORK_ORDER_TASK_COMPLETED: 'maintenance.task.completed',
  DOWNTIME_RECORDED: 'maintenance.downtime.recorded',
  DOWNTIME_ENDED: 'maintenance.downtime.ended',
  COST_RECORDED: 'maintenance.cost.recorded',
  PART_USAGE_RECORDED: 'maintenance.part.recorded',
  DOCUMENT_ADDED: 'maintenance.document.added',
  DOCUMENT_REMOVED: 'maintenance.document.removed',
  // Sprint 22 — Maintenance Ecosystem Integration
  // (docs/domains/maintenance-integration.md). See maintenance-events.ts
  // for the cross-referenced business-event catalog these actions stand
  // in for until a real dispatcher exists.
  PART_USAGE_ISSUED: 'maintenance.part.issued',
  PART_USAGE_CANCELLED: 'maintenance.part.cancelled',
  PROCUREMENT_REQUIREMENT_IDENTIFIED: 'maintenance.procurement.identified',
  PROCUREMENT_REQUIREMENT_LINKED: 'maintenance.procurement.linked',
  PROCUREMENT_REQUIREMENT_CANCELLED: 'maintenance.procurement.cancelled',
} as const;
