/**
 * HR domain audit action catalog (Sprint 23, docs/domains/hr.md), the
 * exact `MAINTENANCE_AUDIT_ACTIONS` `<entity>.<event>` naming convention.
 */
export const HR_AUDIT_ACTIONS = {
  DEPARTMENT_CREATED: 'hr.department.created',
  DEPARTMENT_UPDATED: 'hr.department.updated',
  DEPARTMENT_ACTIVATED: 'hr.department.activated',
  DEPARTMENT_DEACTIVATED: 'hr.department.deactivated',
  POSITION_CREATED: 'hr.position.created',
  POSITION_UPDATED: 'hr.position.updated',
  POSITION_ACTIVATED: 'hr.position.activated',
  POSITION_DEACTIVATED: 'hr.position.deactivated',
  EMPLOYEE_CREATED: 'hr.employee.created',
  EMPLOYEE_UPDATED: 'hr.employee.updated',
  EMPLOYEE_DEPARTMENT_ASSIGNED: 'hr.employee.department_assigned',
  EMPLOYEE_POSITION_ASSIGNED: 'hr.employee.position_assigned',
  EMPLOYEE_MANAGER_ASSIGNED: 'hr.employee.manager_assigned',
  EMPLOYEE_USER_LINKED: 'hr.employee.user_linked',
  EMPLOYEE_USER_UNLINKED: 'hr.employee.user_unlinked',
  EMPLOYEE_ACTIVATED: 'hr.employee.activated',
  EMPLOYEE_SUSPENDED: 'hr.employee.suspended',
  EMPLOYEE_REACTIVATED: 'hr.employee.reactivated',
  EMPLOYEE_SEPARATED: 'hr.employee.separated',
  EMPLOYEE_DOCUMENT_ADDED: 'hr.employee.document_added',
  EMPLOYEE_DOCUMENT_UPDATED: 'hr.employee.document_updated',
  ONBOARDING_STARTED: 'hr.onboarding.started',
  ONBOARDING_TASK_COMPLETED: 'hr.onboarding.task_completed',
  ONBOARDING_COMPLETED: 'hr.onboarding.completed',
} as const;
