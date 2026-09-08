import { apiFetch, apiFetchFormData } from '@/lib/api-client';

/**
 * Shared API client for Sprint 21's Maintenance Management Foundation
 * (docs/domains/maintenance.md), following the exact `assets/api.ts`
 * one-shared-file convention.
 */

export type MaintenancePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type MaintenanceTypeStatus = 'ACTIVE' | 'INACTIVE';
export type MaintenancePlanStatus = 'ACTIVE' | 'INACTIVE';
export type MaintenanceScheduleType = 'DATE_BASED' | 'METER_BASED';
export type MaintenanceFrequencyUnit = 'DAYS' | 'WEEKS' | 'MONTHS' | 'YEARS';
export type MaintenanceScheduleStatus = 'ACTIVE' | 'INACTIVE';
export type MaintenanceIssueType =
  'BREAKDOWN' | 'PERFORMANCE' | 'SAFETY' | 'NOISE' | 'LEAK' | 'ELECTRICAL' | 'MECHANICAL' | 'OTHER';
export type MaintenanceRequestStatus =
  'OPEN' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'CONVERTED_TO_WORK_ORDER' | 'CANCELLED';
export type WorkOrderStatus =
  'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
export type WorkOrderTaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
export type MaintenanceCostCategory = 'LABOUR' | 'PARTS' | 'SERVICE' | 'TRANSPORT' | 'OTHER';
export type MaintenancePartUsageType = 'CONSUMED' | 'RETURNED';
export type MaintenanceDocumentEntityType = 'REQUEST' | 'WORK_ORDER';
export type MaintenanceDocumentType =
  'BEFORE_PHOTO' | 'AFTER_PHOTO' | 'INVOICE' | 'REPORT' | 'OTHER';

// === Overview ===

export interface MaintenanceOverview {
  openRequests: number;
  openWorkOrders: number;
  inProgress: number;
  overduePreventive: number;
  dueSoonPreventive: number;
  criticalWorkOrders: number;
  assetsUnderMaintenance: number;
  unplannedBreakdownsThisMonth: number;
  downtimeMinutesThisMonth: number;
  maintenanceCostThisMonth: number;
  workOrdersByStatus: Record<string, number>;
  workOrdersByType: { maintenanceTypeId: string; name: string; count: number }[];
}

export function getMaintenanceOverview(): Promise<MaintenanceOverview> {
  return apiFetch<MaintenanceOverview>('/maintenance/overview');
}

export interface Technician {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export function listTechnicians(): Promise<{ items: Technician[] }> {
  return apiFetch<{ items: Technician[] }>('/maintenance/technicians');
}

// === Maintenance Types ===

export interface MaintenanceType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: MaintenanceTypeStatus;
  createdAt: string;
  updatedAt: string;
}

export function listMaintenanceTypes(
  params: { status?: MaintenanceTypeStatus } = {},
): Promise<{ items: MaintenanceType[] }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  const qs = query.toString();
  return apiFetch<{ items: MaintenanceType[] }>(`/maintenance/types${qs ? `?${qs}` : ''}`);
}

export function createMaintenanceType(input: {
  code: string;
  name: string;
  description?: string;
}): Promise<MaintenanceType> {
  return apiFetch<MaintenanceType>('/maintenance/types', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// === Maintenance Plans ===

export interface MaintenancePlanTask {
  id: string;
  title: string;
  description: string | null;
  mandatory: boolean;
  estimatedDurationMinutes: number | null;
}

export interface MaintenancePlan {
  id: string;
  name: string;
  description: string | null;
  maintenanceTypeId: string;
  assetId: string | null;
  assetCategoryId: string | null;
  status: MaintenancePlanStatus;
  priority: MaintenancePriority;
  estimatedDurationMinutes: number | null;
  instructions: string | null;
  safetyNotes: string | null;
  tasks: MaintenancePlanTask[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateMaintenancePlanPayload {
  name: string;
  description?: string;
  maintenanceTypeId: string;
  assetId?: string;
  assetCategoryId?: string;
  priority?: MaintenancePriority;
  estimatedDurationMinutes?: number;
  instructions?: string;
  safetyNotes?: string;
  tasks?: {
    title: string;
    description?: string;
    mandatory?: boolean;
    estimatedDurationMinutes?: number;
  }[];
  idempotencyKey?: string;
}

export function listMaintenancePlans(
  params: { status?: MaintenancePlanStatus; assetId?: string; assetCategoryId?: string } = {},
): Promise<{ items: MaintenancePlan[] }> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const qs = query.toString();
  return apiFetch<{ items: MaintenancePlan[] }>(`/maintenance/plans${qs ? `?${qs}` : ''}`);
}

export function getMaintenancePlan(id: string): Promise<MaintenancePlan> {
  return apiFetch<MaintenancePlan>(`/maintenance/plans/${id}`);
}

export function createMaintenancePlan(
  input: CreateMaintenancePlanPayload,
): Promise<MaintenancePlan> {
  return apiFetch<MaintenancePlan>('/maintenance/plans', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// === Maintenance Schedules ===

export interface MaintenanceSchedule {
  id: string;
  maintenancePlanId: string;
  assetId: string;
  scheduleType: MaintenanceScheduleType;
  frequencyValue: number | null;
  frequencyUnit: MaintenanceFrequencyUnit | null;
  nextDueDate: string | null;
  meterType: string | null;
  meterInterval: number | null;
  nextDueMeterReading: number | null;
  lastGeneratedAt: string | null;
  status: MaintenanceScheduleStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMaintenanceSchedulePayload {
  maintenancePlanId: string;
  assetId: string;
  scheduleType: MaintenanceScheduleType;
  frequencyValue?: number;
  frequencyUnit?: MaintenanceFrequencyUnit;
  nextDueDate?: string;
  meterType?: string;
  meterInterval?: number;
  nextDueMeterReading?: number;
  idempotencyKey?: string;
}

export function listMaintenanceSchedules(
  params: { status?: MaintenanceScheduleStatus; assetId?: string; maintenancePlanId?: string } = {},
): Promise<{ items: MaintenanceSchedule[] }> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const qs = query.toString();
  return apiFetch<{ items: MaintenanceSchedule[] }>(`/maintenance/schedules${qs ? `?${qs}` : ''}`);
}

export function createMaintenanceSchedule(
  input: CreateMaintenanceSchedulePayload,
): Promise<MaintenanceSchedule> {
  return apiFetch<MaintenanceSchedule>('/maintenance/schedules', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface GenerateScheduleResult {
  generated: boolean;
  reason?: string;
  workOrder?: WorkOrder;
  maintenanceSchedule: MaintenanceSchedule;
}

export function generateMaintenanceSchedule(
  id: string,
  idempotencyKey?: string,
): Promise<GenerateScheduleResult> {
  return apiFetch<GenerateScheduleResult>(`/maintenance/schedules/${id}/generate`, {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey }),
  });
}

// === Maintenance Requests ===

export interface MaintenanceRequest {
  id: string;
  requestCode: string;
  assetId: string;
  reportedById: string | null;
  reportedAt: string;
  title: string;
  description: string | null;
  priority: MaintenancePriority;
  issueType: MaintenanceIssueType | null;
  status: MaintenanceRequestStatus;
  requestedDueDate: string | null;
  notes: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMaintenanceRequestPayload {
  assetId: string;
  title: string;
  description?: string;
  priority?: MaintenancePriority;
  issueType?: MaintenanceIssueType;
  requestedDueDate?: string;
  notes?: string;
  idempotencyKey?: string;
}

export function listMaintenanceRequests(
  params: {
    status?: MaintenanceRequestStatus;
    assetId?: string;
    priority?: MaintenancePriority;
  } = {},
): Promise<{ items: MaintenanceRequest[] }> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const qs = query.toString();
  return apiFetch<{ items: MaintenanceRequest[] }>(`/maintenance/requests${qs ? `?${qs}` : ''}`);
}

export function getMaintenanceRequest(id: string): Promise<MaintenanceRequest> {
  return apiFetch<MaintenanceRequest>(`/maintenance/requests/${id}`);
}

export function createMaintenanceRequest(
  input: CreateMaintenanceRequestPayload,
): Promise<MaintenanceRequest> {
  return apiFetch<MaintenanceRequest>('/maintenance/requests', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function approveMaintenanceRequest(id: string): Promise<MaintenanceRequest> {
  return apiFetch<MaintenanceRequest>(`/maintenance/requests/${id}/approve`, { method: 'POST' });
}

export function rejectMaintenanceRequest(
  id: string,
  rejectionReason: string,
): Promise<MaintenanceRequest> {
  return apiFetch<MaintenanceRequest>(`/maintenance/requests/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ rejectionReason }),
  });
}

export function cancelMaintenanceRequest(id: string): Promise<MaintenanceRequest> {
  return apiFetch<MaintenanceRequest>(`/maintenance/requests/${id}/cancel`, { method: 'POST' });
}

export function convertMaintenanceRequest(
  id: string,
  input: {
    maintenanceTypeId: string;
    plannedStartAt?: string;
    plannedEndAt?: string;
    assignedToId?: string;
    idempotencyKey?: string;
  },
): Promise<{ maintenanceRequest: MaintenanceRequest; workOrder: WorkOrder }> {
  return apiFetch<{ maintenanceRequest: MaintenanceRequest; workOrder: WorkOrder }>(
    `/maintenance/requests/${id}/convert`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

// === Work Orders ===

export interface WorkOrderTask {
  id: string;
  workOrderId: string;
  sequence: number;
  title: string;
  description: string | null;
  status: WorkOrderTaskStatus;
  mandatory: boolean;
  assignedToId: string | null;
  estimatedDurationMinutes: number | null;
  actualDurationMinutes: number | null;
  completedAt: string | null;
  completedById: string | null;
  notes: string | null;
}

export interface WorkOrder {
  id: string;
  workOrderCode: string;
  assetId: string;
  maintenanceTypeId: string;
  maintenancePlanId: string | null;
  maintenanceRequestId: string | null;
  title: string;
  description: string | null;
  priority: MaintenancePriority;
  status: WorkOrderStatus;
  assignedToId: string | null;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  completedAt: string | null;
  failureReason: string | null;
  rootCause: string | null;
  correctiveAction: string | null;
  resolution: string | null;
  notes: string | null;
  isExternalService: boolean;
  externalSupplierId: string | null;
  externalProviderName: string | null;
  externalReference: string | null;
  externalSentAt: string | null;
  externalReturnedAt: string | null;
  meterReadingId: string | null;
  tasks: WorkOrderTask[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkOrderPayload {
  assetId: string;
  maintenanceTypeId: string;
  maintenanceRequestId?: string;
  title: string;
  description?: string;
  priority?: MaintenancePriority;
  assignedToId?: string;
  plannedStartAt?: string;
  plannedEndAt?: string;
  failureReason?: string;
  isExternalService?: boolean;
  externalSupplierId?: string;
  externalProviderName?: string;
  externalReference?: string;
  externalSentAt?: string;
  notes?: string;
  idempotencyKey?: string;
}

export function listWorkOrders(
  params: {
    status?: WorkOrderStatus;
    priority?: MaintenancePriority;
    assetId?: string;
    assignedToId?: string;
    maintenanceTypeId?: string;
    isPreventive?: boolean;
    search?: string;
  } = {},
): Promise<{ items: WorkOrder[] }> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  const qs = query.toString();
  return apiFetch<{ items: WorkOrder[] }>(`/maintenance/work-orders${qs ? `?${qs}` : ''}`);
}

export function getWorkOrder(id: string): Promise<WorkOrder> {
  return apiFetch<WorkOrder>(`/maintenance/work-orders/${id}`);
}

export function createWorkOrder(input: CreateWorkOrderPayload): Promise<WorkOrder> {
  return apiFetch<WorkOrder>('/maintenance/work-orders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function assignWorkOrder(id: string, assignedToId: string): Promise<WorkOrder> {
  return apiFetch<WorkOrder>(`/maintenance/work-orders/${id}/assign`, {
    method: 'POST',
    body: JSON.stringify({ assignedToId }),
  });
}

export function startWorkOrder(id: string): Promise<WorkOrder> {
  return apiFetch<WorkOrder>(`/maintenance/work-orders/${id}/start`, { method: 'POST' });
}

export function holdWorkOrder(id: string, reason?: string): Promise<WorkOrder> {
  return apiFetch<WorkOrder>(`/maintenance/work-orders/${id}/hold`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function resumeWorkOrder(id: string): Promise<WorkOrder> {
  return apiFetch<WorkOrder>(`/maintenance/work-orders/${id}/resume`, { method: 'POST' });
}

export function cancelWorkOrder(id: string, reason?: string): Promise<WorkOrder> {
  return apiFetch<WorkOrder>(`/maintenance/work-orders/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export interface CompleteWorkOrderPayload {
  resolution: string;
  rootCause?: string;
  correctiveAction?: string;
  notes?: string;
  meterReading?: number;
  meterType?: string;
  externalReturnedAt?: string;
  idempotencyKey?: string;
}

export function completeWorkOrder(id: string, input: CompleteWorkOrderPayload): Promise<WorkOrder> {
  return apiFetch<WorkOrder>(`/maintenance/work-orders/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listWorkOrderTasks(id: string): Promise<{ items: WorkOrderTask[] }> {
  return apiFetch<{ items: WorkOrderTask[] }>(`/maintenance/work-orders/${id}/tasks`);
}

export function addWorkOrderTask(
  id: string,
  input: {
    title: string;
    description?: string;
    mandatory?: boolean;
    estimatedDurationMinutes?: number;
  },
): Promise<WorkOrderTask> {
  return apiFetch<WorkOrderTask>(`/maintenance/work-orders/${id}/tasks`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateWorkOrderTask(
  id: string,
  taskId: string,
  input: { status?: WorkOrderTaskStatus; actualDurationMinutes?: number; notes?: string },
): Promise<WorkOrderTask> {
  return apiFetch<WorkOrderTask>(`/maintenance/work-orders/${id}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export interface MaintenanceAuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export function getWorkOrderAuditHistory(id: string): Promise<{ items: MaintenanceAuditEvent[] }> {
  return apiFetch<{ items: MaintenanceAuditEvent[] }>(`/maintenance/work-orders/${id}/audit`);
}

// === Documents (photos) ===

export interface MaintenanceDocument {
  id: string;
  entityType: MaintenanceDocumentEntityType;
  entityId: string;
  documentType: MaintenanceDocumentType;
  url: string;
  key: string;
  fileName: string | null;
  caption: string | null;
  createdAt: string;
}

export function listWorkOrderDocuments(id: string): Promise<{ items: MaintenanceDocument[] }> {
  return apiFetch<{ items: MaintenanceDocument[] }>(`/maintenance/work-orders/${id}/documents`);
}

export function addWorkOrderDocument(
  id: string,
  file: File,
  documentType: MaintenanceDocumentType,
  caption?: string,
): Promise<MaintenanceDocument> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('documentType', documentType);
  if (caption) formData.append('caption', caption);
  return apiFetchFormData<MaintenanceDocument>(
    `/maintenance/work-orders/${id}/documents`,
    formData,
  );
}

// === Downtime ===

export interface AssetDowntime {
  id: string;
  assetId: string;
  workOrderId: string;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  reason: string | null;
  planned: boolean;
  recordedById: string | null;
  createdAt: string;
}

export function listDowntime(
  params: { assetId?: string; workOrderId?: string } = {},
): Promise<{ items: AssetDowntime[] }> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const qs = query.toString();
  return apiFetch<{ items: AssetDowntime[] }>(`/maintenance/downtime${qs ? `?${qs}` : ''}`);
}

export function recordDowntime(input: {
  workOrderId: string;
  startedAt: string;
  endedAt?: string;
  reason?: string;
  planned?: boolean;
  idempotencyKey?: string;
}): Promise<AssetDowntime> {
  return apiFetch<AssetDowntime>('/maintenance/downtime', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function endDowntime(id: string, endedAt?: string): Promise<AssetDowntime> {
  return apiFetch<AssetDowntime>(`/maintenance/downtime/${id}/end`, {
    method: 'POST',
    body: JSON.stringify({ endedAt }),
  });
}

// === Parts Usage ===

export interface MaintenancePartUsage {
  id: string;
  workOrderId: string;
  productId: string;
  quantity: number;
  unitOfMeasure: string | null;
  usageType: MaintenancePartUsageType;
  notes: string | null;
  createdAt: string;
}

export function listPartUsage(workOrderId: string): Promise<{ items: MaintenancePartUsage[] }> {
  return apiFetch<{ items: MaintenancePartUsage[] }>(
    `/maintenance/parts?workOrderId=${workOrderId}`,
  );
}

export function recordPartUsage(input: {
  workOrderId: string;
  productId: string;
  quantity: number;
  usageType?: MaintenancePartUsageType;
  notes?: string;
  idempotencyKey?: string;
}): Promise<MaintenancePartUsage> {
  return apiFetch<MaintenancePartUsage>('/maintenance/parts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// === Costs ===

export interface MaintenanceCost {
  id: string;
  workOrderId: string;
  category: MaintenanceCostCategory;
  description: string | null;
  quantity: number;
  unitCost: number;
  totalCost: number;
  currency: string;
  supplierId: string | null;
  createdAt: string;
}

export function listCosts(workOrderId: string): Promise<{ items: MaintenanceCost[] }> {
  return apiFetch<{ items: MaintenanceCost[] }>(`/maintenance/costs?workOrderId=${workOrderId}`);
}

export function recordCost(input: {
  workOrderId: string;
  category: MaintenanceCostCategory;
  description?: string;
  quantity?: number;
  unitCost: number;
  currency?: string;
  supplierId?: string;
  idempotencyKey?: string;
}): Promise<MaintenanceCost> {
  return apiFetch<MaintenanceCost>('/maintenance/costs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// === Asset History ===

export interface AssetMaintenanceHistory {
  workOrders: WorkOrder[];
  downtimes: AssetDowntime[];
  totalCost: number;
  lastMaintenance: WorkOrder | null;
  upcomingSchedules: MaintenanceSchedule[];
}

export function getAssetMaintenanceHistory(assetId: string): Promise<AssetMaintenanceHistory> {
  return apiFetch<AssetMaintenanceHistory>(`/maintenance/assets/${assetId}/history`);
}

export function getAssetOpenWork(assetId: string): Promise<{ items: WorkOrder[] }> {
  return apiFetch<{ items: WorkOrder[] }>(`/maintenance/assets/${assetId}/open-work`);
}
