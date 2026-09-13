import { apiFetch, apiFetchFormData } from '@/lib/api-client';

/**
 * Shared API client for Sprint 23's HR Employee Lifecycle Foundation
 * (docs/domains/hr.md), following the exact `assets/api.ts`/
 * `maintenance/api.ts` one-shared-file convention.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DepartmentStatus = 'ACTIVE' | 'INACTIVE';
export type PositionStatus = 'ACTIVE' | 'INACTIVE';
export type EmploymentType =
  'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'TEMPORARY' | 'INTERN' | 'CASUAL' | 'VOLUNTEER';
export type EmploymentStatus =
  'DRAFT' | 'ONBOARDING' | 'ACTIVE' | 'ON_LEAVE' | 'SUSPENDED' | 'SEPARATED';
export type Gender = 'MALE' | 'FEMALE' | 'OTHER' | 'PREFER_NOT_TO_SAY';
export type EmployeeDocumentType =
  | 'EMPLOYMENT_CONTRACT'
  | 'IDENTIFICATION'
  | 'QUALIFICATION'
  | 'CERTIFICATION'
  | 'POLICY_ACKNOWLEDGEMENT'
  | 'ONBOARDING_DOCUMENT'
  | 'OTHER';
export type EmployeeDocumentStatus = 'ACTIVE' | 'ARCHIVED';
export type OnboardingStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface Department {
  id: string;
  code: string;
  name: string;
  description: string | null;
  parentDepartmentId: string | null;
  departmentHeadEmployeeId: string | null;
  status: DepartmentStatus;
  employeeCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Position {
  id: string;
  code: string;
  title: string;
  description: string | null;
  departmentId: string | null;
  reportsToPositionId: string | null;
  status: PositionStatus;
  employeeCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Employee {
  id: string;
  employeeCode: string;
  userId: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  preferredName: string | null;
  workEmail: string | null;
  personalEmail: string | null;
  phoneNumber: string | null;
  alternatePhoneNumber: string | null;
  dateOfBirth: string | null;
  gender: Gender | null;
  nationality: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelationship: string | null;
  departmentId: string | null;
  positionId: string | null;
  managerEmployeeId: string | null;
  employmentType: EmploymentType;
  employmentStatus: EmploymentStatus;
  hireDate: string;
  probationEndDate: string | null;
  confirmationDate: string | null;
  separationDate: string | null;
  separationReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeListRow extends Employee {
  department: { id: string; name: string } | null;
  position: { id: string; title: string } | null;
  manager: { id: string; firstName: string; lastName: string } | null;
  user: { id: string } | null;
}

export interface EmployeeDetail extends Employee {
  department: Department | null;
  position: Position | null;
  manager: { id: string; employeeCode: string; firstName: string; lastName: string } | null;
  user: { id: string; email: string; status: string } | null;
  _count: { directReports: number };
}

export interface EmployeeDocument {
  id: string;
  employeeId: string;
  documentType: EmployeeDocumentType;
  name: string;
  description: string | null;
  url: string;
  issuedDate: string | null;
  expiryDate: string | null;
  status: EmployeeDocumentStatus;
  uploadedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeOnboardingTask {
  id: string;
  onboardingId: string;
  title: string;
  description: string | null;
  isRequired: boolean;
  completedAt: string | null;
  completedByUserId: string | null;
  sortOrder: number;
}

export interface EmployeeOnboarding {
  id: string;
  employeeId: string;
  status: OnboardingStatus;
  startedAt: string | null;
  targetCompletionDate: string | null;
  completedAt: string | null;
  notes: string | null;
  tasks: EmployeeOnboardingTask[];
}

export interface AuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  createdAt: string;
}

export interface HrOverview {
  totalEmployees: number;
  activeEmployees: number;
  onboardingEmployees: number;
  employeesWithoutUser: number;
  departmentCount: number;
  openOnboardingTasks: number;
  attendanceToday: { present: number; late: number; pendingReview: number };
  attendanceRequiringReview: number;
  pendingPolicyAcknowledgements: number;
  activeTrainingAssignments: number;
  overdueTrainingAssignments: number;
  recentActivity: AuditEvent[];
}

// ---------------------------------------------------------------------------
// Sprint 24 — Work schedules, Attendance, Policies, Training
// ---------------------------------------------------------------------------

export type WorkScheduleStatus = 'ACTIVE' | 'INACTIVE';
export type AttendanceStatus =
  'PRESENT' | 'LATE' | 'ABSENT' | 'INCOMPLETE' | 'OFF_DAY' | 'EXCUSED' | 'PENDING_REVIEW';
export type AttendanceReviewStatus =
  'NOT_REVIEWED' | 'APPROVED' | 'REQUIRES_CORRECTION' | 'REJECTED';
export type AttendanceSource = 'SELF_SERVICE' | 'ADMINISTRATIVE' | 'IMPORTED';
export type AttendanceCorrectionStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type PolicyScopeType = 'ORGANISATION' | 'DEPARTMENT';
export type PolicyStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type PolicyVersionStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type PolicyAcknowledgementSource = 'SELF_SERVICE' | 'ADMINISTRATIVE';
export type TrainingDeliveryMode = 'IN_PERSON' | 'ONLINE' | 'BLENDED' | 'SELF_STUDY';
export type TrainingCourseStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type EmployeeTrainingStatus =
  'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED';

export interface WorkSchedule {
  id: string;
  code: string;
  name: string;
  description: string | null;
  workDays: number[];
  expectedStartTime: string;
  expectedEndTime: string;
  gracePeriodMinutes: number;
  status: WorkScheduleStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  attendanceDate: string;
  workScheduleId: string | null;
  signInAt: string | null;
  signInLatitude: number | null;
  signInLongitude: number | null;
  signInAccuracyMeters: number | null;
  signInLocationLabel: string | null;
  signOutAt: string | null;
  signOutLatitude: number | null;
  signOutLongitude: number | null;
  signOutAccuracyMeters: number | null;
  signOutLocationLabel: string | null;
  status: AttendanceStatus;
  reviewStatus: AttendanceReviewStatus;
  source: AttendanceSource;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  employee?: { id: string; employeeCode: string; firstName: string; lastName: string };
}

export interface AttendanceCorrectionRequest {
  id: string;
  attendanceRecordId: string;
  requestedByEmployeeId: string | null;
  requestedByUserId: string;
  requestedSignInAt: string | null;
  requestedSignOutAt: string | null;
  reason: string;
  status: AttendanceCorrectionStatus;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  createdAt: string;
}

export interface Policy {
  id: string;
  code: string;
  title: string;
  description: string | null;
  scopeType: PolicyScopeType;
  departmentId: string | null;
  ownerDepartmentId: string | null;
  status: PolicyStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyVersion {
  id: string;
  policyId: string;
  versionNumber: number;
  content: string;
  effectiveDate: string;
  requiresAcknowledgement: boolean;
  publishedAt: string | null;
  publishedByUserId: string | null;
  status: PolicyVersionStatus;
  createdAt: string;
}

export interface PolicyAcknowledgement {
  id: string;
  employeeId: string;
  policyVersionId: string;
  acknowledgedAt: string;
  acknowledgedByUserId: string | null;
  source: PolicyAcknowledgementSource;
  notes: string | null;
}

export interface TrainingCourse {
  id: string;
  code: string;
  title: string;
  description: string | null;
  provider: string | null;
  deliveryMode: TrainingDeliveryMode;
  durationMinutes: number | null;
  validityPeriodDays: number | null;
  status: TrainingCourseStatus;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeTraining {
  id: string;
  employeeId: string;
  trainingCourseId: string;
  assignedByUserId: string;
  assignedAt: string;
  dueDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  status: EmployeeTrainingStatus;
  completionNotes: string | null;
  certificateDocumentId: string | null;
  trainingCourse?: { id: string; code: string; title: string };
  employee?: { id: string; employeeCode: string; firstName: string; lastName: string };
}

// --- Work schedules ---

export function listWorkSchedules(params: { status?: WorkScheduleStatus } = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  const qs = query.toString();
  return apiFetch<{ items: WorkSchedule[] }>(`/hr/work-schedules${qs ? `?${qs}` : ''}`);
}

export function getWorkSchedule(id: string) {
  return apiFetch<WorkSchedule>(`/hr/work-schedules/${id}`);
}

export interface CreateWorkSchedulePayload {
  code: string;
  name: string;
  description?: string;
  workDays: number[];
  expectedStartTime: string;
  expectedEndTime: string;
  gracePeriodMinutes?: number;
}

export function createWorkSchedule(payload: CreateWorkSchedulePayload) {
  return apiFetch<WorkSchedule>('/hr/work-schedules', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateWorkSchedule(id: string, payload: Partial<CreateWorkSchedulePayload>) {
  return apiFetch<WorkSchedule>(`/hr/work-schedules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function activateWorkSchedule(id: string) {
  return apiFetch<WorkSchedule>(`/hr/work-schedules/${id}/activate`, { method: 'POST' });
}

export function deactivateWorkSchedule(id: string) {
  return apiFetch<WorkSchedule>(`/hr/work-schedules/${id}/deactivate`, { method: 'POST' });
}

export function assignEmployeeWorkSchedule(id: string, workScheduleId: string | null) {
  return apiFetch<Employee>(`/hr/employees/${id}/work-schedule`, {
    method: 'POST',
    body: JSON.stringify({ workScheduleId }),
  });
}

// --- Attendance ---

export interface LocationCapture {
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  locationLabel?: string;
}

export function getMyAttendance(dateFrom?: string, dateTo?: string) {
  const query = new URLSearchParams();
  if (dateFrom) query.set('dateFrom', dateFrom);
  if (dateTo) query.set('dateTo', dateTo);
  const qs = query.toString();
  return apiFetch<{ employeeId: string; items: AttendanceRecord[] }>(
    `/hr/attendance/me${qs ? `?${qs}` : ''}`,
  );
}

export function signIn(location?: LocationCapture) {
  return apiFetch<AttendanceRecord>('/hr/attendance/sign-in', {
    method: 'POST',
    body: JSON.stringify({ location }),
  });
}

export function signOut(location?: LocationCapture) {
  return apiFetch<AttendanceRecord>('/hr/attendance/sign-out', {
    method: 'POST',
    body: JSON.stringify({ location }),
  });
}

export function requestAttendanceCorrection(
  attendanceRecordId: string,
  payload: { requestedSignInAt?: string; requestedSignOutAt?: string; reason: string },
) {
  return apiFetch<AttendanceCorrectionRequest>(`/hr/attendance/${attendanceRecordId}/corrections`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface ListAttendanceParams {
  page?: number;
  pageSize?: number;
  employeeId?: string;
  departmentId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: AttendanceStatus;
  reviewStatus?: AttendanceReviewStatus;
}

export interface ListAttendanceResult {
  items: AttendanceRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export function listAttendance(params: ListAttendanceParams = {}): Promise<ListAttendanceResult> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  const qs = query.toString();
  return apiFetch<ListAttendanceResult>(`/hr/attendance${qs ? `?${qs}` : ''}`);
}

export function getAttendanceRecord(id: string) {
  return apiFetch<AttendanceRecord & { corrections: AttendanceCorrectionRequest[] }>(
    `/hr/attendance/${id}`,
  );
}

export function administrativeAttendanceEntry(payload: {
  employeeId: string;
  attendanceDate: string;
  signIn?: boolean;
  signOut?: boolean;
  notes?: string;
}) {
  return apiFetch<AttendanceRecord>('/hr/attendance/administrative', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function reviewAttendance(
  id: string,
  payload: { reviewStatus: 'APPROVED' | 'REQUIRES_CORRECTION' | 'REJECTED'; notes?: string },
) {
  return apiFetch<AttendanceRecord>(`/hr/attendance/${id}/review`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function listAttendanceCorrections(attendanceRecordId: string) {
  return apiFetch<{ items: AttendanceCorrectionRequest[] }>(
    `/hr/attendance/${attendanceRecordId}/corrections`,
  );
}

export function reviewAttendanceCorrection(
  id: string,
  payload: { decision: 'APPROVED' | 'REJECTED'; reviewComment?: string },
) {
  return apiFetch<AttendanceCorrectionRequest>(`/hr/attendance/corrections/${id}/review`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getEmployeeAttendance(id: string, dateFrom?: string, dateTo?: string) {
  const query = new URLSearchParams();
  if (dateFrom) query.set('dateFrom', dateFrom);
  if (dateTo) query.set('dateTo', dateTo);
  const qs = query.toString();
  return apiFetch<AttendanceRecord[]>(`/hr/employees/${id}/attendance${qs ? `?${qs}` : ''}`);
}

// --- Policies ---

export function listPolicies(params: { status?: PolicyStatus } = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  const qs = query.toString();
  return apiFetch<{ items: Policy[] }>(`/hr/policies${qs ? `?${qs}` : ''}`);
}

export function getPolicy(id: string) {
  return apiFetch<Policy>(`/hr/policies/${id}`);
}

export interface CreatePolicyPayload {
  code: string;
  title: string;
  description?: string;
  scopeType?: PolicyScopeType;
  departmentId?: string;
  ownerDepartmentId?: string;
}

export function createPolicy(payload: CreatePolicyPayload) {
  return apiFetch<Policy>('/hr/policies', { method: 'POST', body: JSON.stringify(payload) });
}

export function updatePolicy(id: string, payload: Partial<CreatePolicyPayload>) {
  return apiFetch<Policy>(`/hr/policies/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function archivePolicy(id: string) {
  return apiFetch<Policy>(`/hr/policies/${id}/archive`, { method: 'POST' });
}

export function listPolicyVersions(policyId: string) {
  return apiFetch<{ items: PolicyVersion[] }>(`/hr/policies/${policyId}/versions`);
}

export function createPolicyVersion(
  policyId: string,
  payload: { content: string; effectiveDate: string; requiresAcknowledgement?: boolean },
) {
  return apiFetch<PolicyVersion>(`/hr/policies/${policyId}/versions`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function publishPolicyVersion(policyId: string, versionId: string) {
  return apiFetch<PolicyVersion>(`/hr/policies/${policyId}/versions/${versionId}/publish`, {
    method: 'POST',
  });
}

export function acknowledgePolicyVersion(
  policyId: string,
  versionId: string,
  payload: { employeeId?: string; notes?: string } = {},
) {
  return apiFetch<PolicyAcknowledgement>(
    `/hr/policies/${policyId}/versions/${versionId}/acknowledge`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export function getEmployeePolicyAcknowledgements(id: string) {
  return apiFetch<{ items: PolicyAcknowledgement[] }>(
    `/hr/employees/${id}/policy-acknowledgements`,
  );
}

// --- Training ---

export function listTrainingCourses(params: { status?: TrainingCourseStatus } = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  const qs = query.toString();
  return apiFetch<{ items: TrainingCourse[] }>(`/hr/training/courses${qs ? `?${qs}` : ''}`);
}

export function getTrainingCourse(id: string) {
  return apiFetch<TrainingCourse>(`/hr/training/courses/${id}`);
}

export interface CreateTrainingCoursePayload {
  code: string;
  title: string;
  description?: string;
  provider?: string;
  deliveryMode: TrainingDeliveryMode;
  durationMinutes?: number;
  validityPeriodDays?: number;
}

export function createTrainingCourse(payload: CreateTrainingCoursePayload) {
  return apiFetch<TrainingCourse>('/hr/training/courses', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateTrainingCourse(id: string, payload: Partial<CreateTrainingCoursePayload>) {
  return apiFetch<TrainingCourse>(`/hr/training/courses/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function activateTrainingCourse(id: string) {
  return apiFetch<TrainingCourse>(`/hr/training/courses/${id}/activate`, { method: 'POST' });
}

export function archiveTrainingCourse(id: string) {
  return apiFetch<TrainingCourse>(`/hr/training/courses/${id}/archive`, { method: 'POST' });
}

export function assignTraining(
  courseId: string,
  payload: { employeeId: string; dueDate?: string },
) {
  return apiFetch<EmployeeTraining>(`/hr/training/courses/${courseId}/assignments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface ListEmployeeTrainingParams {
  page?: number;
  pageSize?: number;
  employeeId?: string;
  trainingCourseId?: string;
  status?: EmployeeTrainingStatus;
}

export interface ListEmployeeTrainingResult {
  items: EmployeeTraining[];
  total: number;
  page: number;
  pageSize: number;
}

export function listTrainingAssignments(
  params: ListEmployeeTrainingParams = {},
): Promise<ListEmployeeTrainingResult> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  const qs = query.toString();
  return apiFetch<ListEmployeeTrainingResult>(`/hr/training/assignments${qs ? `?${qs}` : ''}`);
}

export function getTrainingAssignment(id: string) {
  return apiFetch<EmployeeTraining>(`/hr/training/assignments/${id}`);
}

export function updateTrainingAssignment(
  id: string,
  payload: {
    status?: 'ASSIGNED' | 'IN_PROGRESS' | 'CANCELLED';
    dueDate?: string | null;
    completionNotes?: string | null;
    certificateDocumentId?: string | null;
  },
) {
  return apiFetch<EmployeeTraining>(`/hr/training/assignments/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function completeTrainingAssignment(
  id: string,
  payload: { completionNotes?: string; certificateDocumentId?: string } = {},
) {
  return apiFetch<EmployeeTraining>(`/hr/training/assignments/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function cancelTrainingAssignment(id: string) {
  return apiFetch<EmployeeTraining>(`/hr/training/assignments/${id}/cancel`, { method: 'POST' });
}

export function getEmployeeTraining(id: string) {
  return apiFetch<{ items: EmployeeTraining[] }>(`/hr/employees/${id}/training`);
}

export interface OrganisationStructure {
  departments: Department[];
  positions: Position[];
  employees: {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    employmentStatus: EmploymentStatus;
    departmentId: string | null;
    positionId: string | null;
    managerEmployeeId: string | null;
  }[];
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

export function listDepartments(params: { status?: DepartmentStatus } = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  const qs = query.toString();
  return apiFetch<{ items: Department[] }>(`/hr/departments${qs ? `?${qs}` : ''}`);
}

export function getDepartment(id: string) {
  return apiFetch<Department>(`/hr/departments/${id}`);
}

export function listDepartmentEmployees(id: string) {
  return apiFetch<{ items: EmployeeListRow[] }>(`/hr/departments/${id}/employees`);
}

export interface CreateDepartmentPayload {
  code: string;
  name: string;
  description?: string;
  parentDepartmentId?: string;
  departmentHeadEmployeeId?: string;
}

export function createDepartment(payload: CreateDepartmentPayload) {
  return apiFetch<Department>('/hr/departments', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateDepartment(id: string, payload: Partial<CreateDepartmentPayload>) {
  return apiFetch<Department>(`/hr/departments/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function activateDepartment(id: string) {
  return apiFetch<Department>(`/hr/departments/${id}/activate`, { method: 'POST' });
}

export function deactivateDepartment(id: string) {
  return apiFetch<Department>(`/hr/departments/${id}/deactivate`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

export function listPositions(params: { status?: PositionStatus; departmentId?: string } = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.departmentId) query.set('departmentId', params.departmentId);
  const qs = query.toString();
  return apiFetch<{ items: Position[] }>(`/hr/positions${qs ? `?${qs}` : ''}`);
}

export function getPosition(id: string) {
  return apiFetch<Position>(`/hr/positions/${id}`);
}

export function listPositionEmployees(id: string) {
  return apiFetch<{ items: EmployeeListRow[] }>(`/hr/positions/${id}/employees`);
}

export interface CreatePositionPayload {
  code: string;
  title: string;
  description?: string;
  departmentId?: string;
  reportsToPositionId?: string;
}

export function createPosition(payload: CreatePositionPayload) {
  return apiFetch<Position>('/hr/positions', { method: 'POST', body: JSON.stringify(payload) });
}

export function updatePosition(id: string, payload: Partial<CreatePositionPayload>) {
  return apiFetch<Position>(`/hr/positions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function activatePosition(id: string) {
  return apiFetch<Position>(`/hr/positions/${id}/activate`, { method: 'POST' });
}

export function deactivatePosition(id: string) {
  return apiFetch<Position>(`/hr/positions/${id}/deactivate`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export interface ListEmployeesParams {
  page?: number;
  pageSize?: number;
  search?: string;
  departmentId?: string;
  positionId?: string;
  employmentType?: EmploymentType;
  employmentStatus?: EmploymentStatus;
  unlinkedOnly?: boolean;
}

export interface ListEmployeesResult {
  items: EmployeeListRow[];
  total: number;
  page: number;
  pageSize: number;
}

export function listEmployees(params: ListEmployeesParams = {}): Promise<ListEmployeesResult> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  const qs = query.toString();
  return apiFetch<ListEmployeesResult>(`/hr/employees${qs ? `?${qs}` : ''}`);
}

export function getEmployee(id: string) {
  return apiFetch<EmployeeDetail>(`/hr/employees/${id}`);
}

export interface CreateEmployeePayload {
  firstName: string;
  middleName?: string;
  lastName: string;
  preferredName?: string;
  workEmail?: string;
  personalEmail?: string;
  phoneNumber?: string;
  alternatePhoneNumber?: string;
  dateOfBirth?: string;
  gender?: Gender;
  nationality?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelationship?: string;
  departmentId?: string;
  positionId?: string;
  managerEmployeeId?: string;
  employmentType: EmploymentType;
  hireDate: string;
  probationEndDate?: string;
  notes?: string;
}

export function createEmployee(payload: CreateEmployeePayload) {
  return apiFetch<Employee>('/hr/employees', { method: 'POST', body: JSON.stringify(payload) });
}

export function updateEmployee(id: string, payload: Partial<CreateEmployeePayload>) {
  return apiFetch<Employee>(`/hr/employees/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function assignEmployeeDepartment(id: string, departmentId: string | null) {
  return apiFetch<Employee>(`/hr/employees/${id}/department`, {
    method: 'POST',
    body: JSON.stringify({ departmentId }),
  });
}

export function assignEmployeePosition(id: string, positionId: string | null) {
  return apiFetch<Employee>(`/hr/employees/${id}/position`, {
    method: 'POST',
    body: JSON.stringify({ positionId }),
  });
}

export function assignEmployeeManager(id: string, managerEmployeeId: string | null) {
  return apiFetch<Employee>(`/hr/employees/${id}/manager`, {
    method: 'POST',
    body: JSON.stringify({ managerEmployeeId }),
  });
}

export function linkEmployeeUser(id: string, userId: string) {
  return apiFetch<Employee>(`/hr/employees/${id}/link-user`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

export function unlinkEmployeeUser(id: string) {
  return apiFetch<Employee>(`/hr/employees/${id}/unlink-user`, { method: 'POST' });
}

export function activateEmployee(id: string) {
  return apiFetch<Employee>(`/hr/employees/${id}/activate`, { method: 'POST' });
}

export function suspendEmployee(id: string, reason?: string) {
  return apiFetch<Employee>(`/hr/employees/${id}/suspend`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function reactivateEmployee(id: string) {
  return apiFetch<Employee>(`/hr/employees/${id}/reactivate`, { method: 'POST' });
}

export function separateEmployee(id: string, separationDate: string, separationReason?: string) {
  return apiFetch<Employee>(`/hr/employees/${id}/separate`, {
    method: 'POST',
    body: JSON.stringify({ separationDate, separationReason }),
  });
}

export function getEmployeeAuditHistory(id: string) {
  return apiFetch<{ items: AuditEvent[] }>(`/hr/employees/${id}/audit`);
}

// ---------------------------------------------------------------------------
// Employee documents
// ---------------------------------------------------------------------------

export function listEmployeeDocuments(id: string) {
  return apiFetch<{ items: EmployeeDocument[] }>(`/hr/employees/${id}/documents`);
}

export function addEmployeeDocument(
  employeeId: string,
  file: File,
  documentType: EmployeeDocumentType,
  name: string,
  description?: string,
  issuedDate?: string,
  expiryDate?: string,
) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('documentType', documentType);
  formData.append('name', name);
  if (description) formData.append('description', description);
  if (issuedDate) formData.append('issuedDate', issuedDate);
  if (expiryDate) formData.append('expiryDate', expiryDate);
  return apiFetchFormData<EmployeeDocument>(`/hr/employees/${employeeId}/documents`, formData);
}

export function updateEmployeeDocument(
  employeeId: string,
  documentId: string,
  payload: {
    name?: string;
    description?: string | null;
    issuedDate?: string | null;
    expiryDate?: string | null;
    status?: EmployeeDocumentStatus;
  },
) {
  return apiFetch<EmployeeDocument>(`/hr/employees/${employeeId}/documents/${documentId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export function getEmployeeOnboarding(id: string) {
  return apiFetch<EmployeeOnboarding>(`/hr/employees/${id}/onboarding`);
}

export function startOnboarding(id: string, targetCompletionDate?: string) {
  return apiFetch<EmployeeOnboarding>(`/hr/employees/${id}/onboarding/start`, {
    method: 'POST',
    body: JSON.stringify({ targetCompletionDate }),
  });
}

export function completeOnboardingTask(id: string, taskId: string) {
  return apiFetch<EmployeeOnboardingTask>(`/hr/employees/${id}/onboarding/tasks/${taskId}`, {
    method: 'PATCH',
  });
}

export function completeOnboarding(id: string, notes?: string) {
  return apiFetch<EmployeeOnboarding>(`/hr/employees/${id}/onboarding/complete`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

// ---------------------------------------------------------------------------
// Overview / Organisation structure
// ---------------------------------------------------------------------------

export function getHrOverview() {
  return apiFetch<HrOverview>('/hr/overview');
}

export function getOrganisationStructure() {
  return apiFetch<OrganisationStructure>('/hr/organisation-structure');
}
