import { Label } from '@zentuva/ui';

/** Shared by every Workspace Settings tab (Sprint 3.4) — extracted here rather than
 *  repeated six times across General/Branding/Regional/Business/Preferences. */
export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground">{label}</Label>
      <p className="rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-foreground">
        {value}
      </p>
    </div>
  );
}
