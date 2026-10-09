/**
 * Sprint 45 — Reporting & Business Intelligence Foundation. Shared loading/empty/
 * error states for every report page — brief §15 "clear empty states where a tenant
 * has no relevant records," never fabricated placeholder figures.
 */

export function ReportLoading() {
  return <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>;
}

export function ReportError({ message }: { message: string }) {
  return <p className="py-8 text-center text-sm text-destructive">{message}</p>;
}

export function ReportEmpty({ message = 'No records for this period.' }: { message?: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{message}</p>;
}
