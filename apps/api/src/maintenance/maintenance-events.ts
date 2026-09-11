import { MAINTENANCE_AUDIT_ACTIONS } from './maintenance-audit-actions';

/**
 * Maintenance business-event catalog (Sprint 22, docs/domains/
 * maintenance-integration.md "Business Events") — decision #13. No
 * `EventEmitter`/`DomainEvent`/`NotificationService` exists anywhere in
 * this codebase (confirmed by a full-repo grep before this file was
 * written), and `@nestjs/event-emitter` is not a dependency. Per the
 * brief's own "do not build a parallel notification system" instruction,
 * this file is deliberately just a plain, exported name+shape catalog —
 * no emitter, no subscriber, no new npm dependency, nothing wired to
 * anything. Every event name here is cross-referenced to the
 * `MAINTENANCE_AUDIT_ACTIONS` entry already recorded at that exact
 * moment — the audit trail already carries every field (actor, tenant,
 * timestamp, operation, entity, entityId) a future real dispatcher would
 * need, so it *is* the event log until one is built.
 */
export const MAINTENANCE_EVENTS = {
  WORK_ORDER_ASSIGNED: {
    name: 'maintenance.work_order.assigned',
    auditAction: MAINTENANCE_AUDIT_ACTIONS.WORK_ORDER_ASSIGNED,
  },
  WORK_ORDER_STARTED: {
    name: 'maintenance.work_order.started',
    auditAction: MAINTENANCE_AUDIT_ACTIONS.WORK_ORDER_STARTED,
  },
  WORK_ORDER_COMPLETED: {
    name: 'maintenance.work_order.completed',
    auditAction: MAINTENANCE_AUDIT_ACTIONS.WORK_ORDER_COMPLETED,
  },
  PARTS_REQUESTED: {
    name: 'maintenance.parts.requested',
    auditAction: MAINTENANCE_AUDIT_ACTIONS.PART_USAGE_RECORDED,
  },
  PARTS_ISSUED: {
    name: 'maintenance.parts.issued',
    auditAction: MAINTENANCE_AUDIT_ACTIONS.PART_USAGE_ISSUED,
  },
  REQUEST_APPROVED: {
    name: 'maintenance.request.approved',
    auditAction: MAINTENANCE_AUDIT_ACTIONS.MAINTENANCE_REQUEST_APPROVED,
  },
  REQUEST_REJECTED: {
    name: 'maintenance.request.rejected',
    auditAction: MAINTENANCE_AUDIT_ACTIONS.MAINTENANCE_REQUEST_REJECTED,
  },
  /** No scheduler infrastructure fires this — `nextDueDate`/`OVERDUE` are
   *  read lazily off `MaintenanceSchedule` at query time (Sprint 21). The
   *  event name is catalogued here so a future scheduled job can reuse
   *  it once one exists; nothing calls it yet. */
  SCHEDULE_DUE: {
    name: 'maintenance.schedule.due',
    auditAction: MAINTENANCE_AUDIT_ACTIONS.MAINTENANCE_SCHEDULE_GENERATED,
  },
  SCHEDULE_OVERDUE: {
    name: 'maintenance.schedule.overdue',
    auditAction: MAINTENANCE_AUDIT_ACTIONS.MAINTENANCE_SCHEDULE_GENERATED,
  },
  DOWNTIME_STARTED: {
    name: 'maintenance.downtime.started',
    auditAction: MAINTENANCE_AUDIT_ACTIONS.DOWNTIME_RECORDED,
  },
  DOWNTIME_ENDED: {
    name: 'maintenance.downtime.ended',
    auditAction: MAINTENANCE_AUDIT_ACTIONS.DOWNTIME_ENDED,
  },
  PROCUREMENT_IDENTIFIED: {
    name: 'maintenance.procurement.identified',
    auditAction: MAINTENANCE_AUDIT_ACTIONS.PROCUREMENT_REQUIREMENT_IDENTIFIED,
  },
  PROCUREMENT_LINKED: {
    name: 'maintenance.procurement.linked',
    auditAction: MAINTENANCE_AUDIT_ACTIONS.PROCUREMENT_REQUIREMENT_LINKED,
  },
} as const;

export type MaintenanceEventName =
  (typeof MAINTENANCE_EVENTS)[keyof typeof MAINTENANCE_EVENTS]['name'];

// === Payload shapes — documentation only, never constructed/emitted ===

export interface WorkOrderAssignedPayload {
  workOrderId: string;
  workOrderCode: string;
  assignedToId: string;
}

export interface WorkOrderStartedPayload {
  workOrderId: string;
  workOrderCode: string;
  actualStartAt: string;
}

export interface WorkOrderCompletedPayload {
  workOrderId: string;
  workOrderCode: string;
  assetId: string;
  totalCost: number;
}

export interface PartsRequestedPayload {
  partUsageId: string;
  workOrderId: string;
  productId: string;
  quantity: number;
}

export interface PartsIssuedPayload {
  partUsageId: string;
  workOrderId: string;
  productId: string;
  quantity: number;
  locationId: string;
  totalCost: number;
  inventoryTransactionId: string;
}

export interface RequestApprovedPayload {
  requestId: string;
  requestCode: string;
  workOrderId: string;
}

export interface RequestRejectedPayload {
  requestId: string;
  requestCode: string;
  rejectionReason: string | null;
}

export interface ScheduleDuePayload {
  scheduleId: string;
  assetId: string;
  nextDueDate: string;
}

export interface ScheduleOverduePayload {
  scheduleId: string;
  assetId: string;
  nextDueDate: string;
}

export interface DowntimeStartedPayload {
  downtimeId: string;
  assetId: string;
  workOrderId: string | null;
  reason: string | null;
}

export interface DowntimeEndedPayload {
  downtimeId: string;
  assetId: string;
  durationMinutes: number;
}

export interface ProcurementIdentifiedPayload {
  requirementId: string;
  workOrderId: string;
  description: string;
  estimatedCost: number | null;
}

export interface ProcurementLinkedPayload {
  requirementId: string;
  workOrderId: string;
  purchaseOrderId: string;
}
