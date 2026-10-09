'use client';

import { useState } from 'react';
import { Button } from '@zentuva/ui';

import { downloadReportExport } from '@/app/(app)/reports/api';

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation (brief §14). Triggers the
 * server-side CSV export route for one report — the same authorization and tenant
 * scoping as the interactive report apply, since the export endpoint re-runs the
 * exact same permission check (this button has no client-side bypass path).
 */
export function ExportButton({ path, filename }: { path: string; filename: string }) {
  const [state, setState] = useState<'idle' | 'downloading' | 'error'>('idle');

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={state === 'downloading'}
        onClick={async () => {
          setState('downloading');
          try {
            await downloadReportExport(path, filename);
            setState('idle');
          } catch {
            setState('error');
          }
        }}
      >
        {state === 'downloading' ? 'Exporting…' : 'Export CSV'}
      </Button>
      {state === 'error' && <span className="text-xs text-destructive">Export failed.</span>}
    </div>
  );
}
