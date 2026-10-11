import { Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { ReportEmpty } from './report-states';

export interface ActivityRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
}

/** A small, known set of `entityType` → route mappings this codebase can confidently
 *  resolve — deliberately NOT exhaustive (brief §5E "do not invent a link"); any
 *  `entityType` not listed here renders with no link rather than a guessed route. */
const ENTITY_ROUTES: Record<string, (id: string) => string> = {
  SalesOrder: (id) => `/settings/sales/orders/${id}`,
  ProductionOrder: (id) => `/settings/production/orders/${id}`,
  PurchaseOrder: (id) => `/settings/procurement/orders/${id}`,
};

function formatAction(action: string, entityType: string): string {
  // Audit actions are dotted strings like "sales.order.confirm" — rendered as a
  // plain, readable sentence fragment rather than left as a raw internal key.
  const verb = action.split('.').pop() ?? action;
  return `${entityType}: ${verb.replace(/_/g, ' ')}`;
}

/**
 * Sprint 46 — Executive & Management Dashboards (brief §5E "Recent Business
 * Activity"). Reuses the existing `AuditLog` table verbatim via
 * `AuditService.listByOrganisation` — no new event/timeline system, no duplicate
 * activity records created for display purposes (brief's own explicit
 * requirements). Every row is a REAL recorded audit event with a REAL timestamp;
 * this component never fabricates one.
 */
export function ActivityFeed({ rows }: { rows: ActivityRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ReportEmpty message="No recent activity recorded for this organisation." />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((row) => {
          const href = row.entityId ? ENTITY_ROUTES[row.entityType]?.(row.entityId) : undefined;
          const label = formatAction(row.action, row.entityType);
          const timestamp = new Date(row.createdAt).toLocaleString('en-NG', {
            dateStyle: 'medium',
            timeStyle: 'short',
          });
          return (
            <div key={row.id} className="flex items-center justify-between text-sm">
              {href ? (
                <a href={href} className="hover:underline">
                  {label}
                </a>
              ) : (
                <span>{label}</span>
              )}
              <span className="text-xs text-muted-foreground">{timestamp}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
