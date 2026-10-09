import { Card, CardContent } from '@zentuva/ui';

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation. A single KPI card —
 * shared across every report page. `percentChange` is `null` whenever the backend's
 * `calculatePercentChange` couldn't safely compute one (zero/undefined baseline,
 * brief §9) — rendered as "No comparison data," never a misleading 0%/—%.
 */
export function SummaryCard({
  label,
  value,
  percentChange,
}: {
  label: string;
  value: string;
  percentChange?: number | null;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
        {percentChange !== undefined && (
          <p
            className={
              percentChange === null
                ? 'mt-1 text-xs text-muted-foreground'
                : percentChange >= 0
                  ? 'mt-1 text-xs text-primary'
                  : 'mt-1 text-xs text-destructive'
            }
          >
            {percentChange === null
              ? 'No comparison data'
              : `${percentChange >= 0 ? '+' : ''}${percentChange.toFixed(1)}% vs. prior period`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
