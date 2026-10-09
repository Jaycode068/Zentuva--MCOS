import Link from 'next/link';

/** Sprint 45 — shared report-page header: back link, title, description, and an
 *  action slot (period selector / export button) — used by every report page so the
 *  layout never diverges page to page. */
export function ReportPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Link href="/reports" className="text-xs text-muted-foreground hover:underline">
        ← All Reports
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
