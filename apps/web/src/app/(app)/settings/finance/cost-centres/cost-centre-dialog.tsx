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
  Textarea,
} from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import { createCostCentre, updateCostCentre, type CostCentre } from '../api';

/**
 * Create/edit dialog for a `CostCentre` (Sprint 16, docs/domains/budgeting.md
 * §10) — a lightweight budget-line tag (e.g. "Production", "Sales"), never
 * linked to the Chart of Accounts.
 */
export function CostCentreDialog({
  costCentre,
  onOpenChange,
  onSaved,
}: {
  costCentre?: CostCentre;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(costCentre?.code ?? '');
  const [name, setName] = useState(costCentre?.name ?? '');
  const [description, setDescription] = useState(costCentre?.description ?? '');

  const mutation = useMutation({
    mutationFn: () =>
      costCentre
        ? updateCostCentre(costCentre.id, { name, description: description || null })
        : createCostCentre({ code, name, description: description || undefined }),
    onSuccess: onSaved,
  });

  const canSubmit = code.trim().length > 0 && name.trim().length > 0;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{costCentre ? 'Edit Cost Centre' : 'Add Cost Centre'}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label>Code</Label>
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="e.g. PROD"
            disabled={!!costCentre}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Production"
          />
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
              : 'Failed to save cost centre.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Saving…' : costCentre ? 'Save Changes' : 'Add Cost Centre'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
