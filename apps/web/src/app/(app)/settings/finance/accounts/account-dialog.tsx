'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  Textarea,
} from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import {
  createChartOfAccount,
  updateChartOfAccount,
  type AccountType,
  type ChartOfAccount,
} from '../api';
import { ACCOUNT_TYPE_LABELS } from '../labels';

/** Create/Edit Chart of Account dialog (Sprint 7, docs/domains/accounting.md).
 *  `code`/`type` are immutable once created — only shown, never editable, when
 *  editing an existing account. System accounts (`isSystemAccount`) are otherwise
 *  editable (name/description/parent) — only deactivation is blocked, server-side. */
export function AccountDialog({
  account,
  accounts,
  onOpenChange,
  onSaved,
}: {
  account: ChartOfAccount | null;
  accounts: ChartOfAccount[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(account);
  const [code, setCode] = useState(account?.code ?? '');
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'ASSET');
  const [parentId, setParentId] = useState(account?.parentId ?? '');
  const [description, setDescription] = useState(account?.description ?? '');

  const mutation = useMutation({
    mutationFn: () =>
      isEdit
        ? updateChartOfAccount(account!.id, {
            name,
            description: description || undefined,
            parentId: parentId || null,
          })
        : createChartOfAccount({
            code,
            name,
            type,
            parentId: parentId || undefined,
            description: description || undefined,
          }),
    onSuccess: onSaved,
  });

  const parentOptions = accounts.filter((candidate) => candidate.id !== account?.id);
  const canSubmit = (isEdit || code.trim().length > 0) && name.trim().length > 0;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? `Edit Account — ${account!.code}` : 'Create Account'}</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Code</Label>
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              disabled={isEdit}
              placeholder="e.g. 1210"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select
              value={type}
              onChange={(event) => setType(event.target.value as AccountType)}
              disabled={isEdit}
            >
              {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Trade Receivables"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Parent Account (optional)</Label>
          <Select value={parentId} onChange={(event) => setParentId(event.target.value)}>
            <option value="">No parent — top level</option>
            {parentOptions.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.code} — {candidate.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Description (optional)</Label>
          <Textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to save account.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Account'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
