/**
 * Sprint 45 — Reporting & Business Intelligence Foundation (docs/domains/reporting.md
 * "Export"). The first CSV export utility in this codebase — the audit (brief §14's
 * own "audit existing export capabilities before implementing anything new") found
 * zero `Content-Disposition`/CSV-generation anywhere in `apps/api/src`, and no `csv`/
 * `xlsx` dependency in `apps/api/package.json`; this is genuinely new, minimal, and
 * deliberately dependency-free (a handful of lines of escaping logic does not warrant
 * adding a package).
 */

export interface CsvColumn<Row> {
  key: string;
  label: string;
  /** Extracts and formats this column's cell value for `row`. Defaults to a plain
   *  `String(row[key])` when omitted. */
  value?: (row: Row) => string | number | null | undefined;
}

/** Characters that, as the FIRST character of a cell, cause Excel/Sheets/Numbers to
 *  interpret the cell as a formula when the CSV is opened — the OWASP "CSV Injection"
 *  class of vulnerability (brief §14 "prevent spreadsheet formula injection"). Every
 *  cell value in this codebase's reports is either a server-computed number/date or a
 *  name/label pulled from an existing record (a customer name, a product name, a
 *  step-name snapshot) — exactly the untrusted-text case this guards. */
const FORMULA_TRIGGER_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);

function sanitizeCell(raw: string): string {
  if (raw.length === 0 || !FORMULA_TRIGGER_CHARS.has(raw[0]!)) {
    return raw;
  }
  // A leading +/- on an otherwise plain number (e.g. "-50", "+12.5" — a legitimate
  // negative/positive currency or quantity figure) is never a formula; only `=`/`@`/
  // tab/CR, or a +/- NOT immediately followed by nothing but digits, need escaping.
  if ((raw[0] === '-' || raw[0] === '+') && /^[+-]?\d+(\.\d+)?$/.test(raw)) {
    return raw;
  }
  // Prefixing with a single quote is the standard mitigation — Excel/Sheets render a
  // leading `'` as a plain-text marker (invisible in the rendered cell) rather than
  // evaluating what follows as a formula, while every other CSV reader treats it as
  // ordinary leading text.
  return `'${raw}`;
}

function escapeCsvField(value: string | number | null | undefined): string {
  const text = value == null ? '' : sanitizeCell(String(value));
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Renders `rows` as CSV text with a stable header row. Deliberately synchronous and
 * string-building (never a streaming writer) — every Sprint 45 report applies a
 * page-size/date-range limit before export is ever reached (brief §12/§14 "handle
 * large exports without unbounded memory usage"), so row counts here are always
 * bounded in the thousands, not millions.
 */
export function toCsv<Row>(columns: CsvColumn<Row>[], rows: Row[]): string {
  const header = columns.map((col) => escapeCsvField(col.label)).join(',');
  const lines = rows.map((row) =>
    columns
      .map((col) =>
        escapeCsvField(
          col.value ? col.value(row) : ((row as Record<string, unknown>)[col.key] as never),
        ),
      )
      .join(','),
  );
  return [header, ...lines].join('\r\n');
}
