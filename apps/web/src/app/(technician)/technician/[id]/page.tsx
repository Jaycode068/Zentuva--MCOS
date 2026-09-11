'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  Sheet,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Textarea,
} from '@zentuva/ui';

import { FieldStickyActionBar } from '@/components/field/FieldStickyActionBar';
import { getAccountProfile } from '@/lib/account';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import {
  addWorkOrderDocument,
  assignWorkOrder,
  cancelPartUsage,
  completeWorkOrder,
  endDowntime,
  getAsset,
  getWorkOrder,
  holdWorkOrder,
  issuePartUsage,
  listDowntime,
  listInventoryLocations,
  listPartUsage,
  listProcurementRequirements,
  listProducts,
  listWorkOrderDocuments,
  recordDowntime,
  recordPartUsage,
  resumeWorkOrder,
  startWorkOrder,
  updateWorkOrderTask,
} from '../api';
import {
  MAINTENANCE_PRIORITY_LABELS,
  MAINTENANCE_PRIORITY_VARIANT,
  PART_USAGE_STATUS_LABELS,
  PART_USAGE_STATUS_VARIANT,
  PROCUREMENT_STATUS_LABELS,
  PROCUREMENT_STATUS_VARIANT,
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_STATUS_VARIANT,
} from '../labels';

/**
 * Field Technician Work Order detail (Sprint 22, docs/domains/
 * maintenance-integration.md "Field Technician Experience") — the primary
 * mobile screen a technician works from, built on the exact same
 * Maintenance API/endpoints the Admin Work Order detail page already
 * calls (no separate mobile backend, no duplicate checklist/downtime/
 * parts/completion logic). One obvious primary action per status, the
 * same status→action mapping Sprint 21's own Admin page already
 * established, presented as a sticky bottom bar (`FieldStickyActionBar`)
 * instead of an inline button, matching the mobile-first shell
 * convention. Lives in its own `(technician)` shell — not under Field
 * Sales — since there is no bottom nav here to sit above, this bar pins
 * to `bottom-0` instead of `FieldStickyActionBar`'s default `bottom-16`.
 */
export default function TechnicianWorkOrderDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const queryClient = useQueryClient();
  const [completeOpen, setCompleteOpen] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ['account', 'profile'],
    queryFn: getAccountProfile,
  });
  const {
    data: workOrder,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['work-order', id],
    queryFn: () => getWorkOrder(id),
  });
  const { data: asset } = useQuery({
    queryKey: ['asset', workOrder?.assetId],
    queryFn: () => getAsset(workOrder!.assetId),
    enabled: !!workOrder,
  });
  const { data: downtimeData } = useQuery({
    queryKey: ['downtime', id],
    queryFn: () => listDowntime({ workOrderId: id }),
  });
  const { data: partsData } = useQuery({
    queryKey: ['parts', id],
    queryFn: () => listPartUsage(id),
  });
  const { data: procurementData } = useQuery({
    queryKey: ['procurement', id],
    queryFn: () => listProcurementRequirements(id),
  });
  const { data: documentsData } = useQuery({
    queryKey: ['wo-documents', id],
    queryFn: () => listWorkOrderDocuments(id),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['work-order', id] });
    queryClient.invalidateQueries({ queryKey: ['work-orders', 'technician'] });
    queryClient.invalidateQueries({ queryKey: ['maintenance-overview'] });
    queryClient.invalidateQueries({ queryKey: ['maintenance-analytics-operational-metrics'] });
    queryClient.invalidateQueries({ queryKey: ['maintenance-analytics-cost-breakdown'] });
    queryClient.invalidateQueries({ queryKey: ['maintenance-analytics-risk-signals'] });
  };

  const startMutation = useMutation({
    mutationFn: async () => {
      if (workOrder?.status === 'OPEN' && profile?.id) {
        await assignWorkOrder(id, profile.id);
      }
      await startWorkOrder(id);
    },
    onSuccess: invalidateAll,
  });
  const holdMutation = useMutation({
    mutationFn: () => holdWorkOrder(id),
    onSuccess: invalidateAll,
  });
  const resumeMutation = useMutation({
    mutationFn: () => resumeWorkOrder(id),
    onSuccess: invalidateAll,
  });

  if (isLoading) {
    return <p className="p-4 text-sm text-muted-foreground">Loading work order…</p>;
  }
  if (isError || !workOrder) {
    return (
      <div className="flex flex-col items-center gap-3 p-4 text-center">
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load work order.'}
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const primaryError = [startMutation, holdMutation, resumeMutation].find((m) => m.isError);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 p-4">
        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <Badge variant={WORK_ORDER_STATUS_VARIANT[workOrder.status]}>
              {WORK_ORDER_STATUS_LABELS[workOrder.status]}
            </Badge>
            <Badge variant={MAINTENANCE_PRIORITY_VARIANT[workOrder.priority]}>
              {MAINTENANCE_PRIORITY_LABELS[workOrder.priority]}
            </Badge>
          </div>
          <h1 className="text-lg font-semibold leading-snug">{workOrder.title}</h1>
          <p className="font-mono text-xs text-muted-foreground">{workOrder.workOrderCode}</p>
          {asset && (
            <a
              href={`/settings/assets/register/${asset.id}`}
              className="mt-1 inline-block text-sm text-primary"
            >
              {asset.name} ({asset.assetCode})
            </a>
          )}
        </div>

        {(workOrder.description || workOrder.failureReason) && (
          <div className="rounded-xl border border-border p-3 text-sm">
            {workOrder.description && <p>{workOrder.description}</p>}
            {workOrder.failureReason && (
              <p className="mt-1 text-muted-foreground">
                <span className="font-medium text-foreground">Failure reason:</span>{' '}
                {workOrder.failureReason}
              </p>
            )}
          </div>
        )}

        {primaryError && (
          <p className="text-sm text-destructive">
            {primaryError.error instanceof ApiError
              ? primaryError.error.message
              : 'That action could not be completed.'}
          </p>
        )}

        <ChecklistCard workOrderId={id} tasks={workOrder.tasks} onChanged={invalidateAll} />

        <DowntimeCard
          workOrderId={id}
          downtimes={downtimeData?.items ?? []}
          onChanged={() => {
            queryClient.invalidateQueries({ queryKey: ['downtime', id] });
            invalidateAll();
          }}
        />

        <PartsCard
          workOrderId={id}
          parts={partsData?.items ?? []}
          onChanged={() => {
            queryClient.invalidateQueries({ queryKey: ['parts', id] });
            invalidateAll();
          }}
        />

        {(procurementData?.items ?? []).length > 0 && (
          <ProcurementCard items={procurementData!.items} />
        )}

        <PhotosCard
          workOrderId={id}
          documents={documentsData?.items ?? []}
          onChanged={() => queryClient.invalidateQueries({ queryKey: ['wo-documents', id] })}
        />

        {workOrder.status === 'COMPLETED' && (
          <div className="rounded-xl border border-border p-3 text-sm">
            <p className="mb-1 font-medium">Resolution</p>
            <p className="text-muted-foreground">{workOrder.resolution ?? '—'}</p>
          </div>
        )}
      </div>

      {(workOrder.status === 'OPEN' ||
        workOrder.status === 'ASSIGNED' ||
        workOrder.status === 'IN_PROGRESS' ||
        workOrder.status === 'ON_HOLD') && (
        <FieldStickyActionBar className="bottom-0 flex-col gap-2">
          {(workOrder.status === 'OPEN' || workOrder.status === 'ASSIGNED') && (
            <Button
              size="touch"
              className="w-full"
              disabled={startMutation.isPending}
              onClick={() => startMutation.mutate()}
            >
              {startMutation.isPending ? 'Starting…' : 'Start Work'}
            </Button>
          )}
          {workOrder.status === 'IN_PROGRESS' && (
            <>
              <Button size="touch" className="w-full" onClick={() => setCompleteOpen(true)}>
                Complete Work Order
              </Button>
              <Button
                size="touch"
                variant="outline"
                className="w-full"
                disabled={holdMutation.isPending}
                onClick={() => holdMutation.mutate()}
              >
                Hold
              </Button>
            </>
          )}
          {workOrder.status === 'ON_HOLD' && (
            <Button
              size="touch"
              className="w-full"
              disabled={resumeMutation.isPending}
              onClick={() => resumeMutation.mutate()}
            >
              {resumeMutation.isPending ? 'Resuming…' : 'Resume Work'}
            </Button>
          )}
        </FieldStickyActionBar>
      )}

      <FieldCompleteSheet
        workOrderId={id}
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        onCompleted={() => {
          setCompleteOpen(false);
          invalidateAll();
        }}
      />
    </div>
  );
}

function ChecklistCard({
  workOrderId,
  tasks,
  onChanged,
}: {
  workOrderId: string;
  tasks: { id: string; title: string; status: string; mandatory: boolean }[];
  onChanged: () => void;
}) {
  const mutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: 'COMPLETED' | 'SKIPPED' }) =>
      updateWorkOrderTask(workOrderId, taskId, { status }),
    onSuccess: onChanged,
  });

  if (tasks.length === 0) return null;

  const incompleteMandatory = tasks.filter((t) => t.mandatory && t.status !== 'COMPLETED');

  return (
    <div className="rounded-xl border border-border p-3">
      <p className="mb-2 text-sm font-semibold">Checklist</p>
      <ul className="space-y-2">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => mutation.mutate({ taskId: task.id, status: 'COMPLETED' })}
              disabled={task.status === 'COMPLETED' || mutation.isPending}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm ${
                task.status === 'COMPLETED'
                  ? 'border-success bg-success text-success-foreground'
                  : 'border-border'
              }`}
              aria-label={`Mark "${task.title}" complete`}
            >
              {task.status === 'COMPLETED' ? '✓' : ''}
            </button>
            <span
              className={`min-w-0 flex-1 text-sm ${task.status === 'COMPLETED' ? 'text-muted-foreground line-through' : ''}`}
            >
              {task.title}
              {task.mandatory && task.status !== 'COMPLETED' && (
                <span className="ml-1 text-xs text-destructive">*</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {incompleteMandatory.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          * {incompleteMandatory.length} mandatory task(s) must be completed before this work order
          can be marked complete.
        </p>
      )}
    </div>
  );
}

function DowntimeCard({
  workOrderId,
  downtimes,
  onChanged,
}: {
  workOrderId: string;
  downtimes: {
    id: string;
    startedAt: string;
    endedAt: string | null;
    durationMinutes: number | null;
  }[];
  onChanged: () => void;
}) {
  const startMutation = useMutation({
    mutationFn: () =>
      recordDowntime({
        workOrderId,
        startedAt: new Date().toISOString(),
        planned: false,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: onChanged,
  });
  const endMutation = useMutation({
    mutationFn: (id: string) => endDowntime(id),
    onSuccess: onChanged,
  });
  const openDowntime = downtimes.find((d) => !d.endedAt);

  return (
    <div className="rounded-xl border border-border p-3">
      <p className="mb-2 text-sm font-semibold">Downtime</p>
      {downtimes.length === 0 ? (
        <p className="mb-2 text-sm text-muted-foreground">No downtime recorded.</p>
      ) : (
        <ul className="mb-2 space-y-1 text-sm">
          {downtimes.map((d) => (
            <li key={d.id} className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {new Date(d.startedAt).toLocaleString()}
              </span>
              <span className={d.endedAt ? '' : 'font-medium text-destructive'}>
                {d.durationMinutes !== null ? `${d.durationMinutes} min` : 'Active'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {openDowntime ? (
        <Button
          size="touch"
          variant="outline"
          className="w-full"
          disabled={endMutation.isPending}
          onClick={() => endMutation.mutate(openDowntime.id)}
        >
          End Downtime
        </Button>
      ) : (
        <Button
          size="touch"
          variant="outline"
          className="w-full"
          disabled={startMutation.isPending}
          onClick={() => startMutation.mutate()}
        >
          Record Downtime
        </Button>
      )}
    </div>
  );
}

function PartsCard({
  workOrderId,
  parts,
  onChanged,
}: {
  workOrderId: string;
  parts: {
    id: string;
    productId: string;
    quantity: number;
    unitOfMeasure: string | null;
    status: 'REQUESTED' | 'ISSUED' | 'CANCELLED';
    totalCost: number | null;
  }[];
  onChanged: () => void;
}) {
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [issuingId, setIssuingId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState('');

  const { data: productsData } = useQuery({
    queryKey: ['products'],
    queryFn: () => listProducts(),
  });
  const { data: locationsData } = useQuery({
    queryKey: ['inventory-locations'],
    queryFn: () => listInventoryLocations(),
  });
  const productsById = new Map((productsData?.items ?? []).map((p) => [p.id, p]));

  const requestMutation = useMutation({
    mutationFn: () =>
      recordPartUsage({
        workOrderId,
        productId,
        quantity: Number(quantity),
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: () => {
      setProductId('');
      setQuantity('1');
      onChanged();
    },
  });
  const issueMutation = useMutation({
    mutationFn: ({ id, loc }: { id: string; loc: string }) =>
      issuePartUsage(id, { locationId: loc, issueIdempotencyKey: crypto.randomUUID() }),
    onSuccess: () => {
      setIssuingId(null);
      setLocationId('');
      onChanged();
    },
  });
  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelPartUsage(id),
    onSuccess: onChanged,
  });

  return (
    <div className="rounded-xl border border-border p-3">
      <p className="mb-2 text-sm font-semibold">Parts</p>
      {parts.length === 0 ? (
        <p className="mb-2 text-sm text-muted-foreground">No parts requested.</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {parts.map((p) => (
            <li key={p.id} className="rounded-lg bg-muted/30 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {productsById.get(p.productId)?.name ?? p.productId}
                </span>
                <Badge variant={PART_USAGE_STATUS_VARIANT[p.status]}>
                  {PART_USAGE_STATUS_LABELS[p.status]}
                </Badge>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {p.quantity} {p.unitOfMeasure ?? ''}
                </span>
                {p.totalCost !== null && <span>{formatCurrency(p.totalCost, 'NGN')}</span>}
              </div>
              {p.status === 'REQUESTED' && (
                <div className="mt-2">
                  {issuingId === p.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={locationId}
                        onChange={(event) => setLocationId(event.target.value)}
                        className="h-10 min-w-[9rem] flex-1 text-sm"
                      >
                        <option value="">Select location…</option>
                        {(locationsData?.items ?? []).map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name}
                          </option>
                        ))}
                      </Select>
                      <Button
                        size="sm"
                        disabled={!locationId || issueMutation.isPending}
                        onClick={() => issueMutation.mutate({ id: p.id, loc: locationId })}
                      >
                        Confirm
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setIssuingId(p.id)}>
                        Issue
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={cancelMutation.isPending}
                        onClick={() => cancelMutation.mutate(p.id)}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                  {issueMutation.isError && issuingId === p.id && (
                    <p className="mt-1 text-xs text-destructive">
                      {issueMutation.error instanceof ApiError
                        ? issueMutation.error.message
                        : 'Failed to issue part.'}
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Select
          value={productId}
          onChange={(event) => setProductId(event.target.value)}
          className="h-10 min-w-[9rem] flex-1 text-sm"
        >
          <option value="">Select product…</option>
          {(productsData?.items ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Input
          type="number"
          min="0"
          step="0.01"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          className="h-10 w-16 text-sm"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!productId || requestMutation.isPending}
          onClick={() => requestMutation.mutate()}
        >
          Request
        </Button>
      </div>
      {requestMutation.isError && (
        <p className="mt-1 text-xs text-destructive">
          {requestMutation.error instanceof ApiError
            ? requestMutation.error.message
            : 'Failed to request part.'}
        </p>
      )}
    </div>
  );
}

function ProcurementCard({
  items,
}: {
  items: {
    id: string;
    description: string;
    status: 'IDENTIFIED' | 'LINKED' | 'CANCELLED';
    estimatedCost: number | null;
  }[];
}) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="mb-2 text-sm font-semibold">Procurement</p>
      <ul className="space-y-2">
        {items.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{r.description}</span>
            <Badge variant={PROCUREMENT_STATUS_VARIANT[r.status]}>
              {PROCUREMENT_STATUS_LABELS[r.status]}
            </Badge>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Identifying and linking procurement needs is handled by an administrator.
      </p>
    </div>
  );
}

function PhotosCard({
  workOrderId,
  documents,
  onChanged,
}: {
  workOrderId: string;
  documents: { id: string; url: string; documentType: string; caption: string | null }[];
  onChanged: () => void;
}) {
  const mutation = useMutation({
    mutationFn: ({
      file,
      documentType,
    }: {
      file: File;
      documentType: 'BEFORE_PHOTO' | 'AFTER_PHOTO';
    }) => addWorkOrderDocument(workOrderId, file, documentType),
    onSuccess: onChanged,
  });

  return (
    <div className="rounded-xl border border-border p-3">
      <p className="mb-2 text-sm font-semibold">Photos</p>
      {documents.length > 0 && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          {documents.map((doc) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={doc.id}
              src={doc.url}
              alt={doc.caption ?? doc.documentType}
              className="aspect-square rounded-lg object-cover"
            />
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <label className="flex h-11 flex-1 cursor-pointer items-center justify-center rounded-md border border-border text-sm font-medium">
          Before Photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) mutation.mutate({ file, documentType: 'BEFORE_PHOTO' });
            }}
          />
        </label>
        <label className="flex h-11 flex-1 cursor-pointer items-center justify-center rounded-md border border-border text-sm font-medium">
          After Photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) mutation.mutate({ file, documentType: 'AFTER_PHOTO' });
            }}
          />
        </label>
      </div>
    </div>
  );
}

/** Completion sheet — resolution + optional root cause/corrective action +
 *  optional meter reading, the exact `CompleteWorkOrderPayload` shape the
 *  existing `completeWorkOrder()` endpoint already accepts (Sprint 21) —
 *  the server, not this screen, enforces mandatory tasks, valid state, and
 *  transactionally closes any open downtime and records the meter
 *  reading. This screen only ever reflects what the server confirms. */
function FieldCompleteSheet({
  workOrderId,
  open,
  onOpenChange,
  onCompleted,
}: {
  workOrderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
}) {
  const [resolution, setResolution] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [meterReading, setMeterReading] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const mutation = useMutation({
    mutationFn: () =>
      completeWorkOrder(workOrderId, {
        resolution,
        rootCause: rootCause || undefined,
        meterReading: meterReading ? Number(meterReading) : undefined,
        idempotencyKey,
      }),
    onSuccess: () => {
      setResolution('');
      setRootCause('');
      setMeterReading('');
      onCompleted();
    },
  });

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) setIdempotencyKey(crypto.randomUUID());
        onOpenChange(next);
      }}
      side="full"
    >
      <SheetHeader>
        <SheetTitle>Complete Work Order</SheetTitle>
      </SheetHeader>
      <div className="flex-1 space-y-4 overflow-y-auto">
        <div className="space-y-1.5">
          <Label className="text-base">Resolution</Label>
          <Textarea
            className="text-base"
            rows={3}
            value={resolution}
            onChange={(event) => setResolution(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-base">Root Cause (optional)</Label>
          <Textarea
            className="text-base"
            rows={2}
            value={rootCause}
            onChange={(event) => setRootCause(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-base">Meter Reading (optional)</Label>
          <Input
            type="number"
            className="h-12 text-base"
            value={meterReading}
            onChange={(event) => setMeterReading(event.target.value)}
            placeholder="e.g. 4850"
          />
        </div>
        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to complete work order.'}
          </p>
        )}
      </div>
      <SheetFooter>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          className="w-full"
          disabled={!resolution.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Completing…' : 'Complete'}
        </Button>
      </SheetFooter>
    </Sheet>
  );
}
