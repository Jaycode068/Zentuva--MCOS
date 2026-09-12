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
  recentActivity: AuditEvent[];
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
