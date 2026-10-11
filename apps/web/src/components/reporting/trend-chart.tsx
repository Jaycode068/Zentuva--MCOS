'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { ReportEmpty } from './report-states';

export interface TrendChartPoint {
  /** Pre-formatted for the X axis (e.g. "Jan 5") — formatting a `Date` is the
   *  caller's job, this component never parses a raw date string itself. */
  label: string;
  value: number;
}

/**
 * Sprint 46 — Executive & Management Dashboards (brief §5C "Business Trends"). The
 * ONE shared trend-line component for every dashboard — reuses this codebase's
 * existing recharts convention (`settings/finance/cashflow/page.tsx`): a `h-64`
 * `ResponsiveContainer`, `CartesianGrid strokeDasharray="3 3"`, `hsl(var(--primary))`
 * stroke, 11px tick labels. Renders a clear empty state (never an empty/blank chart
 * frame, never a fabricated flat line) when `points` has fewer than 2 entries — a
 * single point has no trend to show.
 */
export function TrendChart({
  title,
  points,
  valueFormatter = (v) => String(v),
  emptyMessage = 'Not enough data points in this period to show a trend.',
}: {
  title: string;
  points: TrendChartPoint[];
  valueFormatter?: (value: number) => string;
  emptyMessage?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {points.length < 2 ? (
          <ReportEmpty message={emptyMessage} />
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} aria-label={title}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={valueFormatter} width={70} />
                <Tooltip formatter={(value) => valueFormatter(Number(value))} />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
