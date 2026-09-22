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
  entry(
    'identity.organisation.manage',
    'NONE',
    "Edit the organisation's profile, workspace settings, and logo",
  ),

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
  entry(
    'finance.decision_analysis.manage',
    'NONE',
    'Create/edit/submit/approve/reject decisions and their scenarios',
  ),
  // Sprint 25.1 additions — closing gaps the original 88-entry catalogue left
  // unmapped for actions that already existed in the app (access-control.md §16).
  entry('finance.journal.create', 'NONE', 'Create a draft journal entry'),
  entry('finance.journal.void', 'NONE', 'Void a posted journal entry'),
  entry('finance.credit_note.view', 'SCOPABLE', 'View credit notes'),
  entry('finance.credit_note.manage', 'NONE', 'Create, issue, and void credit notes'),
  entry(
    'finance.supplier_invoice.manage',
    'NONE',
    'Create/edit/post/void supplier invoices, and acknowledge discrepancies',
  ),
  entry('finance.supplier_payment.cancel', 'NONE', 'Void a recorded supplier payment'),
  entry('finance.cash_account.view', 'NONE', 'View cash accounts and their account numbers'),
  entry(
    'finance.cash_account.manage',
    'NONE',
    'Create/edit/activate/deactivate cash accounts, import bank statements',
  ),
  entry('finance.cash_transaction.cancel', 'NONE', 'Void a recorded cash transaction'),
  entry(
    'finance.cashflow.manage',
    'NONE',
    'Manage cashflow adjustments, forecast items, scenarios, and settings',
  ),

  // --- Procurement ---
  entry('procurement.purchase_order.view', 'SCOPABLE', 'View purchase orders'),
  entry('procurement.purchase_order.create', 'NONE', 'Create a purchase order'),
  entry('procurement.purchase_order.edit', 'NONE', 'Edit a draft purchase order'),
  entry('procurement.purchase_order.cancel', 'NONE', 'Cancel a purchase order'),
  // Sprint 26 — the Workflow engine's first domain integration reuses this existing
  // permission naming convention rather than inventing a workflow-specific one; a
  // WorkflowStep's `requiredPermission` is always an ordinary catalogue permission
  // (docs/domains/workflow.md §2.2).
  entry(
    'procurement.purchase_order.approve',
    'SCOPABLE',
    'Approve a purchase order submitted for approval',
  ),
  entry('procurement.supplier.view', 'NONE', 'View supplier records'),
  entry('procurement.supplier.manage', 'NONE', 'Create/edit supplier records'),

  // --- Inventory ---
  entry('inventory.stock.view', 'SCOPABLE', 'View inventory stock levels'),
  entry('inventory.goods_receipt.create', 'NONE', 'Receive goods against a purchase order'),
  entry('inventory.adjustment.create', 'NONE', 'Record an inventory adjustment'),
  entry('inventory.location.manage', 'NONE', 'Create/edit inventory locations'),
  entry('inventory.supplier_return.create', 'NONE', 'Record a supplier return of received goods'),

  // --- Production ---
  entry('production.order.view', 'SCOPABLE', 'View production orders'),
  entry('production.order.create', 'NONE', 'Create a production order'),
  entry('production.order.edit', 'NONE', 'Edit or plan a production order'),
  entry('production.order.cancel', 'NONE', 'Cancel a production order'),
  entry('production.order.complete', 'NONE', 'Complete a production order'),
  entry('production.material_issue.create', 'NONE', 'Issue raw materials to a production order'),
  entry('production.bill_of_material.view', 'NONE', 'View bills of materials'),
  entry('production.bill_of_material.manage', 'NONE', 'Create/edit bills of materials'),

  // --- Sales ---
  entry('sales.order.view', 'SCOPABLE', 'View sales orders'),
  entry('sales.order.create', 'SCOPABLE', 'Create a sales order'),
  entry('sales.order.edit', 'NONE', 'Edit a draft sales order'),
  entry('sales.order.confirm', 'NONE', 'Confirm a sales order'),
  entry('sales.order.cancel', 'NONE', 'Cancel a sales order'),
  entry('sales.dashboard.view', 'SCOPABLE', 'View sales dashboards and administration'),
  entry('sales.customer.view', 'SCOPABLE', 'View customers and outlets'),
  entry('sales.customer.manage', 'SCOPABLE', 'Create/edit customers and outlets'),
  entry('sales.fulfilment.create', 'NONE', 'Fulfil a sales order'),
  entry('sales.customer_return.manage', 'NONE', 'Record, receive, and cancel customer returns'),

  // --- Distribution ---
  entry('distribution.dispatch.view', 'NONE', 'View dispatches'),
  entry('distribution.dispatch.create', 'NONE', 'Create a dispatch'),
  entry(
    'distribution.dispatch.manage',
    'NONE',
    'Transition a dispatch (in-transit/cancel/fail) and record delivery outcomes',
  ),
  entry('distribution.delivery.complete', 'NONE', 'Mark a delivery complete'),

  // --- Assets ---
  entry('assets.asset.view', 'NONE', 'View the asset register'),
  entry('assets.asset.manage', 'NONE', 'Create/edit assets, categories, and locations'),

  // --- Maintenance ---
  entry('maintenance.work_order.view', 'SCOPABLE', 'View maintenance work orders'),
  entry('maintenance.work_order.create', 'NONE', 'Create a maintenance work order'),
  entry('maintenance.work_order.assign', 'NONE', 'Assign a work order to a technician'),
  entry(
    'maintenance.work_order.manage',
    'NONE',
    'Edit, start/hold/resume/cancel a work order; manage its tasks, documents, parts, costs, downtime, and procurement links',
  ),
  entry('maintenance.work_order.complete', 'SCOPABLE', 'Complete a maintenance work order'),
  entry('maintenance.request.view', 'NONE', 'View maintenance requests'),
  entry(
    'maintenance.request.manage',
    'NONE',
    'Approve, reject, or convert a maintenance request into a work order',
  ),
  entry('maintenance.plan.view', 'NONE', 'View maintenance plans, schedules, and types'),
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
  entry(
    'hr.organisation_structure.view',
    'NONE',
    'View departments, positions, and the organisation structure overview',
  ),
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
  entry('hr.policy.view', 'NONE', "View the organisation's full policy catalogue"),
  entry('hr.policy.manage', 'NONE', 'Create/edit/publish policies and versions'),
  entry('hr.training.view', 'NONE', "View training courses and all employees' assignments"),
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

  // --- Product Catalogue (Sprint 25.1 — genuinely new domain, not in the original
  // 88-entry catalogue at all; families/variants/products are a tightly-coupled
  // hierarchy, grouped under one view/manage pair the same way Assets groups asset +
  // category + location) ---
  entry('catalogue.product.view', 'NONE', 'View the product catalogue'),
  entry(
    'catalogue.product.manage',
    'NONE',
    'Create/edit products, families, and variants; activate/archive a product',
  ),

  // --- Retail Network (Sprint 25.1 — customers/outlets reuse Sales' existing
  // sales.customer.* permissions; territories and network relationships are new) ---
  entry('retail.territory.view', 'NONE', 'View sales territories'),
  entry('retail.territory.manage', 'NONE', 'Create/edit/activate/deactivate territories'),
  entry(
    'retail.network.manage',
    'NONE',
    'Create/edit/deactivate customer-outlet network relationships',
  ),

  // --- Workflow (Sprint 26 — docs/domains/workflow.md §10). A generic, coarse gate on
  // the workflow ENGINE's own endpoints — separate from, and layered underneath, the
  // per-step `requiredPermission` a WorkflowStep configures (e.g.
  // `procurement.purchase_order.approve` above). Holding `workflow.approval.approve`
  // only means "may use the approval system at all"; whether a specific step is
  // actually approvable is a dynamic per-step check the engine performs itself via
  // `EffectiveAccessResolver`, never expressible as a single static permission. ---
  entry('workflow.definition.view', 'NONE', 'View workflow definitions and their steps'),
  entry(
    'workflow.definition.manage',
    'NONE',
    'Create/edit/activate/deactivate workflow definitions and their steps',
  ),
  entry('workflow.instance.view', 'NONE', 'View all workflow instances in the organisation'),
  entry(
    'workflow.instance.submit',
    'NONE',
    'Create and submit a workflow instance for an eligible subject',
  ),
  entry('workflow.instance.cancel', 'NONE', 'Cancel a workflow instance'),
  entry(
    'workflow.approval.view',
    'NONE',
    'View the workflow steps the caller is personally eligible to act on ("My Approvals")',
  ),
  entry('workflow.approval.approve', 'NONE', 'Approve an eligible workflow step'),
  entry('workflow.approval.reject', 'NONE', 'Reject an eligible workflow step'),
  entry('workflow.approval.return', 'NONE', 'Return an eligible workflow step for correction'),
  entry('workflow.audit.view', 'NONE', "View a workflow instance's decision history"),

  // --- Notifications (Sprint 27.1 — operational administration, workstream F) ---
  // Genuinely new administrative capability, not covered by any existing entry:
  // inspecting/retrying the notification EVENT PROCESSOR's own internal reliability
  // state (which WorkflowEvent rows failed to become notifications, and why) is
  // distinct from `workflow.audit.view` (a workflow instance's own decision
  // history) — this is about Notifications' own delivery pipeline, not Workflow's
  // business state.
  entry(
    'notification.processing.view',
    'NONE',
    'View failed/stuck notification processing records for the organisation',
  ),
  entry(
    'notification.processing.manage',
    'NONE',
    'Retry a failed or stuck notification processing record',
  ),

  // --- Notifications: Email delivery (Sprint 28 — operational administration,
  // Workstream G). Genuinely new: this exposes actual recipient email addresses
  // and per-message send history, a distinct trust level from
  // `notification.processing.*` above (which never shows any email content or
  // address, only WorkflowEvent processing metadata).
  entry(
    'notification.email.view',
    'NONE',
    'View email delivery records (including recipient address) for the organisation',
  ),
  entry('notification.email.manage', 'NONE', 'Retry a failed or stuck email delivery'),

  // --- Notifications: WhatsApp delivery (Sprint 29 — operational
  // administration). Genuinely new: exposes actual recipient phone numbers
  // and per-message send history, the same trust level as
  // `notification.email.*` but a DIFFERENT channel's data.
  entry(
    'notification.whatsapp.view',
    'NONE',
    'View WhatsApp delivery records (including recipient phone number) for the organisation',
  ),
  entry('notification.whatsapp.manage', 'NONE', 'Retry a failed or stuck WhatsApp delivery'),

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
