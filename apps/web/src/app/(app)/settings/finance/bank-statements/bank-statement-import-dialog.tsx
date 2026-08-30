'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import Papa from 'papaparse';
import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
} from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import { importBankStatement, listCashAccounts, type BankStatementImportRow } from '../api';

type MappableField =
  | 'transactionDate'
  | 'description'
  | 'reference'
  | 'debit'
  | 'credit'
  | 'valueDate'
  | 'balance'
  | 'externalReference';

const FIELD_LABELS: Record<MappableField, string> = {
  transactionDate: 'Transaction Date',
  description: 'Description',
  reference: 'Reference',
  debit: 'Debit',
  credit: 'Credit',
  valueDate: 'Value Date (optional)',
  balance: 'Balance (optional)',
  externalReference: 'External Reference (optional)',
};

const REQUIRED_FIELDS: MappableField[] = ['transactionDate', 'description'];

/**
 * "Import Bank Statement" dialog (Sprint 14, docs/domains/cash-management.md §7/§8)
 * — a two-phase flow (pick file → map columns), the same `selectedX`-gated pattern
 * `invoice-dialog.tsx`/`create-customer-return-dialog.tsx` already use, not a
 * generic stepper. CSV parsing happens entirely client-side (`papaparse`); the
 * backend receives already-mapped, already-normalised JSON rows and re-validates
 * every one independently — this dialog's own checks are a UX convenience only.
 */
export function BankStatementImportDialog({
  onOpenChange,
  onImported,
}: {
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [cashAccountId, setCashAccountId] = useState('');
  const [filename, setFilename] = useState<string | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<MappableField, string>>>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: cashAccountsData } = useQuery({
    queryKey: ['cash-accounts', 'ACTIVE'],
    queryFn: () => listCashAccounts({ status: 'ACTIVE' }),
  });
  const cashAccounts = cashAccountsData?.items ?? [];

  const mutation = useMutation({
    mutationFn: () => {
      const rows: BankStatementImportRow[] = csvRows.map((row) => ({
        transactionDate: row[mapping.transactionDate!] ?? '',
        description: row[mapping.description!] ?? '',
        reference: mapping.reference ? row[mapping.reference] : undefined,
        debit: mapping.debit ? Number(row[mapping.debit] || 0) : undefined,
        credit: mapping.credit ? Number(row[mapping.credit] || 0) : undefined,
        valueDate: mapping.valueDate ? row[mapping.valueDate] : undefined,
        balance: mapping.balance ? Number(row[mapping.balance] || 0) : undefined,
        externalReference: mapping.externalReference ? row[mapping.externalReference] : undefined,
      }));
      return importBankStatement(cashAccountId, { filename: filename!, rows, idempotencyKey });
    },
    onSuccess: onImported,
  });

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setParseError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (!results.meta.fields || results.meta.fields.length === 0) {
          setParseError('Could not detect any columns in this file.');
          return;
        }
        setFilename(file.name);
        setCsvHeaders(results.meta.fields);
        setCsvRows(results.data);
        // Best-effort auto-guess by header name, still fully editable below.
        const guess: Partial<Record<MappableField, string>> = {};
        for (const field of Object.keys(FIELD_LABELS) as MappableField[]) {
          const match = results.meta.fields.find((header) =>
            header.toLowerCase().includes(field.toLowerCase().replace('transaction', '').trim()),
          );
          if (match) guess[field] = match;
        }
        setMapping(guess);
      },
      error: (parseErr) => setParseError(parseErr.message),
    });
  }

  const canCommit =
    cashAccountId.length > 0 &&
    Boolean(mapping.transactionDate) &&
    Boolean(mapping.description) &&
    (Boolean(mapping.debit) || Boolean(mapping.credit)) &&
    csvRows.length > 0;

  // --- Phase 1: pick cash account + file.
  if (!filename) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>Import Bank Statement</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Cash Account</Label>
            <Select
              value={cashAccountId}
              onChange={(event) => setCashAccountId(event.target.value)}
            >
              <option value="">Select an account…</option>
              {cashAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">
              A CSV export of your bank statement — most banks let you export one for any date
              range.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFileSelect}
            />
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              disabled={!cashAccountId}
              onClick={() => fileInputRef.current?.click()}
            >
              Choose CSV File…
            </Button>
            {!cashAccountId && (
              <p className="mt-2 text-xs text-muted-foreground">Pick a cash account first.</p>
            )}
          </div>

          {parseError && <p className="text-sm text-destructive">{parseError}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </Dialog>
    );
  }

  // --- Phase 2: map CSV columns → Zentuva fields, preview, commit.
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Map Columns — {filename}</DialogTitle>
      </DialogHeader>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <p className="text-sm text-muted-foreground">
          {csvRows.length} row{csvRows.length === 1 ? '' : 's'} detected. Map each Zentuva field to
          the matching column from your file.
        </p>

        <div className="grid grid-cols-2 gap-4">
          {(Object.keys(FIELD_LABELS) as MappableField[]).map((field) => (
            <div key={field} className="space-y-1.5">
              <Label>
                {FIELD_LABELS[field]}
                {REQUIRED_FIELDS.includes(field) && <span className="text-destructive"> *</span>}
              </Label>
              <Select
                value={mapping[field] ?? ''}
                onChange={(event) =>
                  setMapping((prev) => ({ ...prev, [field]: event.target.value || undefined }))
                }
              >
                <option value="">— Not mapped —</option>
                {csvHeaders.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
        {!mapping.debit && !mapping.credit && (
          <p className="text-xs text-destructive">Map at least one of Debit/Credit.</p>
        )}

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 text-right font-medium">Debit</th>
                <th className="px-3 py-2 text-right font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {csvRows.slice(0, 5).map((row, index) => (
                <tr key={index} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    {mapping.transactionDate ? row[mapping.transactionDate] : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {mapping.description ? row[mapping.description] : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {mapping.debit ? row[mapping.debit] : ''}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {mapping.credit ? row[mapping.credit] : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to import statement.'}
          </p>
        )}
        {mutation.isSuccess && (
          <p className="text-sm text-emerald-600">
            Imported {mutation.data.importedRows} of {mutation.data.totalRows} rows (
            {mutation.data.duplicateRows} duplicate{mutation.data.duplicateRows === 1 ? '' : 's'}
            skipped).
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => setFilename(null)}>
          Back
        </Button>
        <Button
          type="button"
          disabled={!canCommit || mutation.isPending || mutation.isSuccess}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Importing…' : 'Import Rows'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
