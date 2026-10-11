import Link from 'next/link';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

export interface HealthIndicatorItem {
  label: string;
  /** `'ok'` = checked, found none (a real, positive result — brief §7 "prefer
   *  explicit states over unexplained composite scores"). `'attention'` = the
   *  objective condition (overdue, failed, pending) is true. Never a fabricated
   *  severity tier beyond this. */
  status: 'ok' | 'attention';
  detail: string;
  href?: string;
}

/**
 * Sprint 46 — Executive & Management Dashboards (brief §5D/§7 "Business Health and
 * Attention Required"). A transparent list of explainable, independently-sourced
 * indicators — deliberately NOT a composite score (brief §7 "do not create an
 * arbitrary single Business Health Score by combining unrelated metrics into a
 * percentage"). `items` already reflects permission filtering by the time it reaches
 * this component (brief §8 "do not send the protected value to the browser and
 * merely hide it with CSS") — an indicator the viewer lacks permission for is simply
 * absent from `items`, not rendered disabled.
 */
export function HealthIndicatorList({ items }: { items: HealthIndicatorItem[] }) {
  if (items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Business Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No business-health indicators are visible to you — this reflects your current
            permissions, not the actual state of the business. Contact an administrator for access.
          </p>
        </CardContent>
      </Card>
    );
  }

  const attentionCount = items.filter((item) => item.status === 'attention').length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Business Health
          {attentionCount === 0 && (
            <span className="ml-2 font-normal text-xs">
              — no issues detected in the categories visible to you
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => {
          const row = (
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div>
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.detail}</p>
              </div>
              <Badge variant={item.status === 'attention' ? 'destructive' : 'default'}>
                {item.status === 'attention' ? 'Attention required' : 'No issues detected'}
              </Badge>
            </div>
          );
          return item.href ? (
            <Link key={item.label} href={item.href} className="block hover:opacity-80">
              {row}
            </Link>
          ) : (
            <div key={item.label}>{row}</div>
          );
        })}
      </CardContent>
    </Card>
  );
}
