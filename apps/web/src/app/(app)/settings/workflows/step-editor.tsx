'use client';

import { Button, Input, Label, Select } from '@zentuva/ui';

import type { AccessScope, WorkflowStepInput } from './api';
import { ACCESS_SCOPE_LABELS } from './labels';

const SCOPE_OPTIONS: AccessScope[] = [
  'ORGANISATION',
  'OWN_RECORDS',
  'OWN_TEAM',
  'DEPARTMENT',
  'ASSIGNED_RECORDS',
  'ASSIGNED_TERRITORY',
  'ASSIGNED_ASSETS',
  'NONE',
];

/** Shared step-list editor for the Workflow Definitions create/edit forms
 *  (docs/domains/workflow.md §9 "Workflow Definitions page"). Sequence is always
 *  derived from row order — no separate sequence input to get out of sync. */
export function StepEditor({
  steps,
  onChange,
}: {
  steps: WorkflowStepInput[];
  onChange: (steps: WorkflowStepInput[]) => void;
}) {
  function updateStep(index: number, patch: Partial<WorkflowStepInput>) {
    const next = steps.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange(next);
  }

  function addStep() {
    onChange([
      ...steps,
      {
        name: '',
        code: '',
        sequence: steps.length + 1,
        requiredPermission: '',
        requiredScope: 'ORGANISATION',
      },
    ]);
  }

  function removeStep(index: number) {
    const next = steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, sequence: i + 1 }));
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {steps.map((step, index) => (
        <div key={index} className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-muted-foreground">
              Step {index + 1}
            </span>
            {steps.length > 1 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => removeStep(index)}
                aria-label={`Remove step ${index + 1}`}
              >
                Remove
              </Button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Step name</Label>
              <Input
                value={step.name}
                onChange={(e) => updateStep(index, { name: e.target.value })}
                placeholder="e.g. Procurement Review"
              />
            </div>
            <div className="space-y-1">
              <Label>Step code</Label>
              <Input
                value={step.code}
                onChange={(e) => updateStep(index, { code: e.target.value.toUpperCase() })}
                placeholder="e.g. PROCUREMENT_REVIEW"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Required permission</Label>
            <Input
              value={step.requiredPermission}
              onChange={(e) => updateStep(index, { requiredPermission: e.target.value })}
              placeholder="e.g. procurement.purchase_order.approve"
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Must be an existing catalogue permission — see Access Control → Roles → Permissions.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Required scope</Label>
              <Select
                value={step.requiredScope ?? ''}
                onChange={(e) =>
                  updateStep(index, {
                    requiredScope: (e.target.value || undefined) as AccessScope | undefined,
                  })
                }
              >
                <option value="">No specific scope required</option>
                {SCOPE_OPTIONS.map((scope) => (
                  <option key={scope} value={scope}>
                    {ACCESS_SCOPE_LABELS[scope]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Explicit approver (optional)</Label>
              <Input
                value={step.assignedUserId ?? ''}
                onChange={(e) => updateStep(index, { assignedUserId: e.target.value || null })}
                placeholder="User id — leave blank for any eligible approver"
              />
            </div>
          </div>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={addStep}>
        Add Step
      </Button>
    </div>
  );
}
