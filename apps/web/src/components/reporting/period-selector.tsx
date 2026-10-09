'use client';

import { Select } from '@zentuva/ui';

import {
  type ComparisonMode,
  type ReportingPeriodPreset,
  REPORTING_PERIOD_PRESET_LABELS,
} from '@/app/(app)/reports/api';

const PRESETS: ReportingPeriodPreset[] = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
];

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation. The reporting period
 * preset dropdown, shared across every report page. Deliberately sends only the
 * PRESET name to the backend (`reporting-period.util.ts` resolves the actual
 * organisation-timezone-aware boundaries server-side) — this component never computes
 * a date range itself, unlike the pre-existing Finance `report-date-range.ts` utility.
 */
export function PeriodSelector({
  preset,
  comparison,
  onChange,
  showComparison = true,
}: {
  preset: ReportingPeriodPreset;
  comparison: ComparisonMode;
  onChange: (preset: ReportingPeriodPreset, comparison: ComparisonMode) => void;
  /** Some reports (e.g. Workforce Summary — a point-in-time headcount snapshot, not
   *  a period-accumulated figure) have no meaningful period-over-period comparison.
   *  Omitting the control entirely there is clearer than showing one that silently
   *  resets itself every render. */
  showComparison?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={preset}
        onChange={(e) => onChange(e.target.value as ReportingPeriodPreset, comparison)}
        className="w-auto"
      >
        {PRESETS.map((p) => (
          <option key={p} value={p}>
            {REPORTING_PERIOD_PRESET_LABELS[p]}
          </option>
        ))}
      </Select>
      {showComparison && (
        <Select
          value={comparison}
          onChange={(e) => onChange(preset, e.target.value as ComparisonMode)}
          className="w-auto"
        >
          <option value="none">No comparison</option>
          <option value="previous_period">vs. previous period</option>
          <option value="previous_year">vs. previous year</option>
        </Select>
      )}
    </div>
  );
}
