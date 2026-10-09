'use client';

import { Button } from '@zentuva/ui';

import { formatCurrency } from '@/lib/format-currency';
import type { ReportColumnDefinition, ReportColumnType } from '@/app/(app)/reports/api';

import { ReportEmpty } from './report-states';

function formatCell(value: unknown, type: ReportColumnType): string {
  if (value == null) return '—';
  switch (type) {
    case 'CURRENCY':
      return formatCurrency(Number(value), 'NGN');
    case 'PERCENT':
      return `${Number(value).toFixed(1)}%`;
    case 'NUMBER':
      return Number(value).toLocaleString('en-NG');
    case 'DATE':
      return new Date(String(value)).toLocaleDateString('en-NG');
    default:
      return String(value);
  }
}

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation (brief §5F "Tabular report
 * view"). A generic, reusable table driven by a report's own column definitions —
 * never a bespoke table per report. `row` is read by `column.key` (a plain object
 * property lookup, never a template-expression evaluator — brief §5B "avoid a
 * generic metric-expression language").
 */
export function ReportDataTable<Row extends object>({
  columns,
  rows,
}: {
  columns: ReportColumnDefinition[];
  rows: Row[];
}) {
  if (rows.length === 0) {
    return <ReportEmpty />;
  }
  const records = rows as Record<string, unknown>[];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            {columns.map((col) => (
              <th key={col.key} className="px-3 py-2 font-medium">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((row, i) => (
            <tr key={i} className="border-b border-border/50">
              {columns.map((col) => (
                <td key={col.key} className="px-3 py-2">
                  {formatCell(row[col.key], col.type)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReportPagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between pt-3 text-sm text-muted-foreground">
      <span>
        Page {page} of {totalPages} · {total} {total === 1 ? 'row' : 'rows'}
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
