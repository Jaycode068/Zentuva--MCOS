/**
 * Sprint 25 — Configurable Access Control (docs/domains/access-control.md §3).
 *
 * The single, centrally-defined, versionable permission catalogue. Every `Permission`
 * row in the database is upserted from this array by `prisma/seed.ts` — this file is
 * the source of truth an administrator's Roles UI reads from (via the seeded rows), not
 * a runtime lookup table domains import individually. Adding a permission means adding
 * one entry here, not touching every controller.
 *
 * `key` follows `module.resource.action` — the exact shape the 7 pre-existing identity
 * permissions (Sprint 1B.1) already used; this just extends it across every currently
 * implemented domain rather than inventing a new convention.
 *
 * `scopeType`:
 * - `NONE` — the permission is organisation-wide the moment it's granted; no
 *   `RolePermission.scope` is meaningful (administrative/global actions).
 * - `SCOPABLE` — a grant of this permission requires an explicit scope; an absent scope
 *   is never treated as unrestricted access (access-control.md §5).
 *
 * Deliberately **not** exhaustive per sub-resource — a coherent MVP catalogue covering
 * every currently-implemented domain's highest-value view/mutate distinctions, not
 * hundreds of permissions nobody configures. New domains/actions get new entries later;
 * this is not meant to be "finished."
 */

export type PermissionScopeTypeValue = 'NONE' | 'SCOPABLE';

export interface PermissionCatalogueEntry {
  key: string;
  domain: string;
  resource: string;
  action: string;
  scopeType: PermissionScopeTypeValue;
  description: string;
}

function entry(
  key: string,
  scopeType: PermissionScopeTypeValue,
  description: string,
): PermissionCatalogueEntry {
  const [domain, resource, action] = key.split('.');
  if (!domain || !resource || !action) {
    throw new Error(`Permission key "${key}" must be "module.resource.action"`);
  }
  return { key, domain, resource, action, scopeType, description };
}

export const PERMISSION_CATALOGUE: PermissionCatalogueEntry[] = [
  // --- Identity (Sprint 1B.1 — unchanged keys, restated here as the catalogue's home) ---
  entry('identity.users.read', 'NONE', 'View users in the organisation'),
  entry('identity.users.update', 'NONE', "Edit a user's profile / suspend / reactivate"),
  entry('identity.invitations.create', 'NONE', 'Invite a new user'),
  entry('identity.invitations.revoke', 'NONE', 'Cancel a pending invitation'),
  entry(
    'identity.roles.manage',
    'NONE',
    'Create/edit/archive non-system roles and their permissions',
  ),
  entry('identity.roles.assign', 'NONE', 'Assign/remove roles on users'),
  entry('identity.audit-logs.read', 'NONE', "View the organisation's audit log"),

  // --- Finance ---
  entry('finance.invoice.view', 'SCOPABLE', 'View customer invoices'),
  entry('finance.invoice.create', 'NONE', 'Create a customer invoice'),
  entry('finance.invoice.issue', 'NONE', 'Issue a draft invoice'),
  entry('finance.invoice.cancel', 'NONE', 'Void/cancel an invoice'),
  entry('finance.payment.view', 'SCOPABLE', 'View customer payments'),
  entry('finance.payment.create', 'SCOPABLE', 'Record a customer payment'),
  entry('finance.payment.cancel', 'NONE', 'Void a recorded payment'),
  entry('finance.supplier_invoice.view', 'SCOPABLE', 'View supplier invoices (Accounts Payable)'),
  entry('finance.supplier_payment.view', 'SCOPABLE', 'View supplier payments'),
  entry('finance.supplier_payment.create', 'SCOPABLE', 'Record a supplier payment'),
  entry('finance.journal.view', 'NONE', 'View journal entries and the general ledger'),
  entry('finance.journal.post', 'NONE', 'Post a journal entry to the general ledger'),
  entry('finance.trial_balance.view', 'NONE', 'View the trial balance'),
  entry('finance.reports.view', 'NONE', 'View financial statements and management reports'),
  entry(
    'finance.chart_of_accounts.manage',
    'NONE',
    'Create/edit chart of accounts and accounting periods',
  ),
  entry('finance.cash_transaction.view', 'SCOPABLE', 'View cash transactions'),
  entry('finance.cash_transaction.create', 'SCOPABLE', 'Record a cash transaction'),
  entry('finance.bank_reconciliation.view', 'NONE', 'View bank statements and reconciliations'),
  entry('finance.bank_reconciliation.perform', 'NONE', 'Perform a bank reconciliation'),
  entry('finance.budget.view', 'NONE', 'View budgets and budget-vs-actual comparisons'),
  entry('finance.budget.manage', 'NONE', 'Create/edit budgets and cost centres'),
  entry(
    'finance.debt.manage',
    'NONE',
    'Manage capital requirements, debt facilities, drawdowns, repayments',
  ),
  entry('finance.investment.manage', 'NONE', 'Manage capital projects and funding'),
  entry(
    'finance.decision_analysis.view',
    'NONE',
    'View the financial decision/scenario-analysis cockpit',
  ),

  // --- Procurement ---
  entry('procurement.purchase_order.view', 'SCOPABLE', 'View purchase orders'),
  entry('procurement.purchase_order.create', 'NONE', 'Create a purchase order'),
  entry('procurement.purchase_order.cancel', 'NONE', 'Cancel a purchase order'),
  entry('procurement.supplier.manage', 'NONE', 'Create/edit supplier records'),

  // --- Inventory ---
  entry('inventory.stock.view', 'SCOPABLE', 'View inventory stock levels'),
  entry('inventory.goods_receipt.create', 'NONE', 'Receive goods against a purchase order'),
  entry('inventory.adjustment.create', 'NONE', 'Record an inventory adjustment'),
  entry('inventory.location.manage', 'NONE', 'Create/edit inventory locations'),

  // --- Production ---
  entry('production.order.view', 'SCOPABLE', 'View production orders'),
  entry('production.order.create', 'NONE', 'Create a production order'),
  entry('production.order.complete', 'NONE', 'Complete a production order'),
  entry('production.material_issue.create', 'NONE', 'Issue raw materials to a production order'),
  entry('production.bill_of_material.manage', 'NONE', 'Create/edit bills of materials'),

  // --- Sales ---
  entry('sales.order.view', 'SCOPABLE', 'View sales orders'),
  entry('sales.order.create', 'SCOPABLE', 'Create a sales order'),
  entry('sales.order.cancel', 'NONE', 'Cancel a sales order'),
  entry('sales.dashboard.view', 'SCOPABLE', 'View sales dashboards and administration'),
  entry('sales.customer.manage', 'SCOPABLE', 'Create/edit customers and outlets'),
  entry('sales.fulfilment.create', 'NONE', 'Fulfil a sales order'),

  // --- Distribution ---
  entry('distribution.dispatch.view', 'NONE', 'View dispatches'),
  entry('distribution.dispatch.create', 'NONE', 'Create a dispatch'),
  entry('distribution.delivery.complete', 'NONE', 'Mark a delivery complete'),

  // --- Assets ---
  entry('assets.asset.view', 'NONE', 'View the asset register'),
  entry('assets.asset.manage', 'NONE', 'Create/edit assets, categories, and locations'),

  // --- Maintenance ---
  entry('maintenance.work_order.view', 'SCOPABLE', 'View maintenance work orders'),
  entry('maintenance.work_order.create', 'NONE', 'Create a maintenance work order'),
  entry('maintenance.work_order.assign', 'NONE', 'Assign a work order to a technician'),
  entry('maintenance.work_order.complete', 'SCOPABLE', 'Complete a maintenance work order'),
  entry('maintenance.request.view', 'NONE', 'View maintenance requests'),
  entry('maintenance.plan.manage', 'NONE', 'Create/edit maintenance plans and schedules'),
  entry('maintenance.analytics.view', 'NONE', 'View maintenance cost/downtime analytics'),

  // --- HR: administrative ---
  entry('hr.employee.view', 'SCOPABLE', "View employees' HR records"),
  entry(
    'hr.employee.edit',
    'NONE',
    'Edit an employee record and assign department/position/manager',
  ),
  entry('hr.employee.separate', 'NONE', 'Suspend, reactivate, or separate an employee'),
  entry('hr.organisation_structure.manage', 'NONE', 'Create/edit departments and positions'),
  entry('hr.onboarding.manage', 'NONE', "Start and manage an employee's onboarding checklist"),
  entry('hr.document.manage', 'NONE', "Add/update an employee's document metadata"),
  entry('hr.schedule.manage', 'NONE', 'Create/edit work schedules and assign them to employees'),
  entry('hr.attendance.view', 'SCOPABLE', "View employees' attendance records"),
  entry('hr.attendance.manage', 'NONE', 'Record attendance administratively and review attendance'),
  entry(
    'hr.attendance.review_correction',
    'NONE',
    'Approve or reject an attendance correction request',
  ),
  entry('hr.policy.manage', 'NONE', 'Create/edit/publish policies and versions'),
  entry('hr.training.manage', 'NONE', 'Create/edit training courses and assign training'),

  // --- HR: common employee self-service (module-gated the same as everything else, but
  // also subject to the organisation's CommonEmployeeAccessPolicy toggles —
  // access-control.md §6) ---
  entry('hr.attendance.self_view', 'NONE', 'View your own attendance history'),
  entry('hr.attendance.self_sign_in', 'NONE', 'Sign yourself in for the day'),
  entry('hr.attendance.self_sign_out', 'NONE', 'Sign yourself out for the day'),
  entry('hr.attendance.correction_submit', 'NONE', 'Request a correction to your own attendance'),
  entry('hr.schedule.self_view', 'NONE', 'View your own work schedule'),
  entry('hr.training.self_view', 'NONE', 'View your own assigned training'),
  entry('hr.policy.self_view', 'NONE', 'View policies applicable to you'),
  entry('hr.policy.self_acknowledge', 'NONE', 'Acknowledge a policy version'),
  entry('hr.employee.self_view', 'NONE', 'View your own employee profile'),

  // --- Access Control (Sprint 25's own administration surface) ---
  entry('access.role.manage', 'NONE', 'Create/edit/archive roles and their permission grants'),
  entry('access.user_access.manage', 'NONE', 'Assign/remove roles on users'),
  entry(
    'access.common_policy.manage',
    'NONE',
    "Configure the organisation's common employee access policy",
  ),
  entry(
    'access.overview.view',
    'NONE',
    'View the access-control overview and effective-access previews',
  ),
];
