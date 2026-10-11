import { Card, CardContent } from '@zentuva/ui';
import Link from 'next/link';

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation. A single KPI card —
 * shared across every report page. `percentChange` is `null` whenever the backend's
 * `calculatePercentChange` couldn't safely compute one (zero/undefined baseline,
 * brief §9) — rendered as "No comparison data," never a misleading 0%/—%.
 *
 * Sprint 46 (brief §5B "do not imply that a positive movement is always favourable")
 * adds `favorableDirection`: every existing call site that omits it keeps the
 * original behaviour (an increase renders in the primary colour, a decrease in the
 * destructive colour) — correct for a plain "more is better" metric like revenue.
 * For a metric where more is actually WORSE (e.g. overdue receivables, failed
 * notifications), the Executive/departmental dashboards pass `'down'` so an INCREASE
 * renders as the warning colour instead; `'neutral'` renders every change in a
 * neutral tone (no colour implies good/bad) for a metric like headcount, where
 * neither direction is inherently favourable. `href`, also new, turns the whole card
 * into a drill-down link to the metric's authoritative report (brief §5B "link to
 * the appropriate report").
 */
export function SummaryCard({
  label,
  value,
  percentChange,
  favorableDirection = 'up',
  href,
}: {
  label: string;
  value: string;
  percentChange?: number | null;
  favorableDirection?: 'up' | 'down' | 'neutral';
  href?: string;
}) {
  const isFavorable =
    percentChange == null || favorableDirection === 'neutral'
      ? null
      : favorableDirection === 'up'
        ? percentChange >= 0
        : percentChange <= 0;

  const body = (
    <CardContent className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {percentChange !== undefined && (
        <p
          className={
            percentChange === null || isFavorable === null
              ? 'mt-1 text-xs text-muted-foreground'
              : isFavorable
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
  );

  if (href) {
    return (
      <Link href={href}>
        <Card className="h-full transition-colors hover:border-primary">{body}</Card>
      </Link>
    );
  }
  return <Card>{body}</Card>;
}
