'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Dialog, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import { createAccountingPeriod } from '../api';

function toDateInputValue(value: string): string {
  return value.slice(0, 10);
}

/** "Create Accounting Period" dialog (Sprint 7, docs/domains/accounting.md). Overlap
 *  against an existing period is rejected server-side — the exact error message is
 *  surfaced as-is, since it already names the conflicting period. */
export function AccountingPeriodDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(() => toDateInputValue(new Date().toISOString()));
  const [endDate, setEndDate] = useState(() => toDateInputValue(new Date().toISOString()));

  const mutation = useMutation({
    mutationFn: () => createAccountingPeriod({ name, startDate, endDate }),
    onSuccess: onCreated,
  });

  const canSubmit = name.trim().length > 0 && startDate && endDate && endDate >= startDate;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Create Accounting Period</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. September 2026"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Start Date</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>End Date</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </div>
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to create period.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create Period'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
