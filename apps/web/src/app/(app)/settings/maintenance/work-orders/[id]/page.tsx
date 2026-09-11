'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  Textarea,
} from '@zentuva/ui';

import { getAsset } from '@/app/(app)/settings/assets/api';
import { listInventoryLocations } from '@/app/(app)/settings/inventory/api';
import { listProducts } from '@/app/(app)/settings/products/api';
import { listPurchaseOrders } from '@/app/(app)/settings/procurement/api';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import {
  type MaintenanceCostCategory,
  type MaintenancePartUsage,
  type MaintenanceProcurementRequirement,
  addWorkOrderDocument,
  assignWorkOrder,
  cancelPartUsage,
  cancelProcurementRequirement,
  cancelWorkOrder,
  completeWorkOrder,
  createProcurementRequirement,
  endDowntime,
  getProcurementApSummary,
  getWorkOrder,
  getWorkOrderAuditHistory,
  holdWorkOrder,
  issuePartUsage,
  linkProcurementRequirement,
  listCosts,
  listDowntime,
  listPartUsage,
  listProcurementRequirements,
  listTechnicians,
  listWorkOrderDocuments,
  recordCost,
  recordDowntime,
  recordPartUsage,
  resumeWorkOrder,
  startWorkOrder,
  updateWorkOrderTask,
} from '../../api';
import {
  MAINTENANCE_COST_CATEGORY_LABELS,
  MAINTENANCE_PRIORITY_LABELS,
  MAINTENANCE_PRIORITY_VARIANT,
  PART_USAGE_STATUS_LABELS,
  PART_USAGE_STATUS_VARIANT,
  PROCUREMENT_STATUS_LABELS,
  PROCUREMENT_STATUS_VARIANT,
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_STATUS_VARIANT,
} from '../../labels';

/**
 * Work Order detail (Sprint 21, docs/domains/maintenance.md) — the
 * technician's primary screen. Mobile-first and touch-friendly: large
 * primary action button, a checklist-style task list, minimal typing.
 */
export default function WorkOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();

  const {
    data: workOrder,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['work-order', id],
    queryFn: () => getWorkOrder(id),
  });
  const { data: asset } = useQuery({
    queryKey: ['asset', workOrder?.assetId],
    queryFn: () => getAsset(workOrder!.assetId),
    enabled: !!workOrder,
  });
  const { data: techniciansData } = useQuery({
    queryKey: ['maintenance-technicians'],
    queryFn: () => listTechnicians(),
  });
  const { data: downtimeData } = useQuery({
    queryKey: ['downtime', id],
    queryFn: () => listDowntime({ workOrderId: id }),
  });
  const { data: partsData } = useQuery({
    queryKey: ['parts', id],
    queryFn: () => listPartUsage(id),
  });
  const { data: costsData } = useQuery({
    queryKey: ['costs', id],
    queryFn: () => listCosts(id),
  });
  const { data: procurementData } = useQuery({
    queryKey: ['procurement', id],
    queryFn: () => listProcurementRequirements(id),
  });
  const { data: documentsData } = useQuery({
    queryKey: ['wo-documents', id],
    queryFn: () => listWorkOrderDocuments(id),
  });
  const { data: auditData } = useQuery({
    queryKey: ['wo-audit', id],
    queryFn: () => getWorkOrderAuditHistory(id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['work-order', id] });
  };

  // Issuing/cancelling a part or recording a cost changes figures the
  // Maintenance Overview and Analytics pages already show (Sprint 22,
  // docs/domains/maintenance-integration.md) — the global QueryClient's
  // 60s staleTime (apps/web/src/providers/query-provider.tsx) would
  // otherwise let a stale cached value linger on those pages for up to a
  // minute after navigating back. Invalidating by query-key prefix here
  // (matching every `from`/`to` variant already cached) keeps them
  // server-authoritative without changing the global cache config.
  const invalidateAnalytics = () => {
    queryClient.invalidateQueries({ queryKey: ['maintenance-overview'] });
    queryClient.invalidateQueries({ queryKey: ['maintenance-analytics-operational-metrics'] });
    queryClient.invalidateQueries({ queryKey: ['maintenance-analytics-cost-breakdown'] });
    queryClient.invalidateQueries({ queryKey: ['maintenance-analytics-cost-vs-budget'] });
    queryClient.invalidateQueries({ queryKey: ['maintenance-analytics-risk-signals'] });
  };

  const assignMutation = useMutation({
    mutationFn: (assignedToId: string) => assignWorkOrder(id, assignedToId),
    onSuccess: invalidate,
  });
  const startMutation = useMutation({
    mutationFn: () => startWorkOrder(id),
    onSuccess: invalidate,
  });
  const holdMutation = useMutation({ mutationFn: () => holdWorkOrder(id), onSuccess: invalidate });
  const resumeMutation = useMutation({
    mutationFn: () => resumeWorkOrder(id),
    onSuccess: invalidate,
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelWorkOrder(id),
    onSuccess: invalidate,
  });

  const [assignedTo, setAssignedTo] = useState('');
  const [completeOpen, setCompleteOpen] = useState(false);

  if (isLoading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 text-sm text-muted-foreground">
        Loading work order…
      </main>
    );
  }
  if (isError || !workOrder) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 text-sm text-destructive">
        {error instanceof ApiError ? error.message : 'Failed to load work order.'}
      </main>
    );
  }

  // Decision #6 (docs/domains/maintenance-integration.md): parts cost is
  // always derived from issued part usages, never hand-entered a second
  // time under MaintenanceCost's own PARTS category.
  const issuedPartsCost = (partsData?.items ?? [])
    .filter((p) => p.status === 'ISSUED' && p.usageType === 'CONSUMED')
    .reduce((sum, p) => sum + (p.totalCost ?? 0), 0);
  const totalCost =
    (costsData?.items ?? []).reduce((sum, c) => sum + c.totalCost, 0) + issuedPartsCost;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <div>
        <Link
          href="/settings/maintenance/work-orders"
          className="text-xs text-muted-foreground hover:underline"
        >
          ← All Work Orders
        </Link>
      </div>

      {/* Header */}
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant={WORK_ORDER_STATUS_VARIANT[workOrder.status]}>
            {WORK_ORDER_STATUS_LABELS[workOrder.status]}
          </Badge>
          <Badge variant={MAINTENANCE_PRIORITY_VARIANT[workOrder.priority]}>
            {MAINTENANCE_PRIORITY_LABELS[workOrder.priority]}
          </Badge>
        </div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{workOrder.title}</h1>
        <p className="font-mono text-xs text-muted-foreground">{workOrder.workOrderCode}</p>
        {asset && (
          <Link
            href={`/settings/assets/register/${asset.id}`}
            className="mt-1 inline-block text-sm text-primary hover:underline"
          >
            {asset.name} ({asset.assetCode})
          </Link>
        )}
      </div>

      {/* Primary action — large, touch-friendly, the technician's next step */}
      <PrimaryAction
        workOrder={workOrder}
        technicians={techniciansData?.items ?? []}
        assignedTo={assignedTo}
        setAssignedTo={setAssignedTo}
        onAssign={(techId) => assignMutation.mutate(techId)}
        onStart={() => startMutation.mutate()}
        onHold={() => holdMutation.mutate()}
        onResume={() => resumeMutation.mutate()}
        onOpenComplete={() => setCompleteOpen(true)}
        isPending={
          assignMutation.isPending ||
          startMutation.isPending ||
          holdMutation.isPending ||
          resumeMutation.isPending
        }
      />

      {workOrder.status !== 'COMPLETED' && workOrder.status !== 'CANCELLED' && (
        <button
          type="button"
          onClick={() => cancelMutation.mutate()}
          className="text-xs text-muted-foreground hover:text-destructive"
        >
          Cancel work order
        </button>
      )}

      {/* Problem */}
      {(workOrder.description || workOrder.failureReason) && (
        <Section title="Problem">
          {workOrder.description && <p className="text-sm">{workOrder.description}</p>}
          {workOrder.failureReason && (
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Failure reason:</span>{' '}
              {workOrder.failureReason}
            </p>
          )}
        </Section>
      )}

      {/* Tasks */}
      <TasksSection workOrderId={id} tasks={workOrder.tasks} onChanged={invalidate} />

      {/* Downtime */}
      <DowntimeSection
        workOrderId={id}
        assetId={workOrder.assetId}
        downtimes={downtimeData?.items ?? []}
        onChanged={() => queryClient.invalidateQueries({ queryKey: ['downtime', id] })}
      />

      {/* Parts */}
      <PartsSection
        workOrderId={id}
        parts={partsData?.items ?? []}
        onChanged={() => {
          queryClient.invalidateQueries({ queryKey: ['parts', id] });
          invalidateAnalytics();
        }}
      />

      {/* Costs */}
      <CostsSection
        workOrderId={id}
        costs={costsData?.items ?? []}
        totalCost={totalCost}
        onChanged={() => {
          queryClient.invalidateQueries({ queryKey: ['costs', id] });
          invalidateAnalytics();
        }}
      />

      {/* Procurement — Sprint 22 */}
      <ProcurementSection
        workOrderId={id}
        requirements={procurementData?.items ?? []}
        onChanged={() => queryClient.invalidateQueries({ queryKey: ['procurement', id] })}
      />

      {/* Photos */}
      <PhotosSection
        workOrderId={id}
        documents={documentsData?.items ?? []}
        onChanged={() => queryClient.invalidateQueries({ queryKey: ['wo-documents', id] })}
      />

      {/* Resolution (once completed) */}
      {workOrder.status === 'COMPLETED' && (
        <Section title="Resolution">
          <Field label="Resolution" value={workOrder.resolution ?? '—'} />
          <Field label="Root Cause" value={workOrder.rootCause ?? '—'} />
          <Field label="Corrective Action" value={workOrder.correctiveAction ?? '—'} />
          <Field
            label="Completed At"
            value={workOrder.completedAt ? new Date(workOrder.completedAt).toLocaleString() : '—'}
          />
        </Section>
      )}

      {/* Audit */}
      <Section title="Audit History">
        {(auditData?.items ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {(auditData?.items ?? []).map((event) => (
              <li key={event.id} className="flex items-center justify-between">
                <span>{event.action}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(event.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {completeOpen && (
        <CompleteDialog
          workOrderId={id}
          onOpenChange={() => setCompleteOpen(false)}
          onCompleted={() => {
            setCompleteOpen(false);
            invalidate();
          }}
        />
      )}
    </main>
  );
}

function PrimaryAction({
  workOrder,
  technicians,
  assignedTo,
  setAssignedTo,
  onAssign,
  onStart,
  onHold,
  onResume,
  onOpenComplete,
  isPending,
}: {
  workOrder: { status: string; assignedToId: string | null };
  technicians: { id: string; firstName: string; lastName: string }[];
  assignedTo: string;
  setAssignedTo: (v: string) => void;
  onAssign: (id: string) => void;
  onStart: () => void;
  onHold: () => void;
  onResume: () => void;
  onOpenComplete: () => void;
  isPending: boolean;
}) {
  if (workOrder.status === 'OPEN') {
    return (
      <div className="space-y-2 rounded-lg border border-border p-4">
        <Label>Assign a technician to begin</Label>
        <div className="flex gap-2">
          <Select
            value={assignedTo}
            onChange={(event) => setAssignedTo(event.target.value)}
            className="flex-1"
          >
            <option value="">Select technician…</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.firstName} {t.lastName}
              </option>
            ))}
          </Select>
          <Button
            size="lg"
            disabled={!assignedTo || isPending}
            onClick={() => onAssign(assignedTo)}
          >
            Assign
          </Button>
        </div>
      </div>
    );
  }
  if (workOrder.status === 'ASSIGNED') {
    return (
      <Button size="lg" className="h-14 w-full text-base" disabled={isPending} onClick={onStart}>
        Start Work
      </Button>
    );
  }
  if (workOrder.status === 'IN_PROGRESS') {
    return (
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="lg" className="h-14 flex-1 text-base" onClick={onOpenComplete}>
          Complete Work Order
        </Button>
        <Button size="lg" variant="outline" className="h-14" disabled={isPending} onClick={onHold}>
          Hold
        </Button>
      </div>
    );
  }
  if (workOrder.status === 'ON_HOLD') {
    return (
      <Button size="lg" className="h-14 w-full text-base" disabled={isPending} onClick={onResume}>
        Resume Work
      </Button>
    );
  }
  return null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2 flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function TasksSection({
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

  return (
    <Section title="Tasks">
      <ul className="space-y-3">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => mutation.mutate({ taskId: task.id, status: 'COMPLETED' })}
              disabled={task.status === 'COMPLETED' || mutation.isPending}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm ${
                task.status === 'COMPLETED'
                  ? 'border-success bg-success text-success-foreground'
                  : 'border-border'
              }`}
              aria-label={`Mark "${task.title}" complete`}
            >
              {task.status === 'COMPLETED' ? '✓' : ''}
            </button>
            <span
              className={`flex-1 text-sm ${task.status === 'COMPLETED' ? 'text-muted-foreground line-through' : ''}`}
            >
              {task.title}
              {task.mandatory && task.status !== 'COMPLETED' && (
                <span className="ml-1 text-xs text-destructive">*</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        * Mandatory — must be completed before the work order can be marked complete.
      </p>
    </Section>
  );
}

function DowntimeSection({
  workOrderId,
  assetId,
  downtimes,
  onChanged,
}: {
  workOrderId: string;
  assetId: string;
  downtimes: {
    id: string;
    startedAt: string;
    endedAt: string | null;
    durationMinutes: number | null;
    planned: boolean;
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
    <Section title="Downtime">
      {downtimes.length === 0 ? (
        <p className="mb-3 text-sm text-muted-foreground">No downtime recorded.</p>
      ) : (
        <ul className="mb-3 space-y-2 text-sm">
          {downtimes.map((d) => (
            <li key={d.id} className="flex items-center justify-between">
              <span>{new Date(d.startedAt).toLocaleString()}</span>
              <span className="text-muted-foreground">
                {d.durationMinutes !== null ? `${d.durationMinutes} min` : 'ongoing'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {openDowntime ? (
        <Button
          variant="outline"
          onClick={() => endMutation.mutate(openDowntime.id)}
          disabled={endMutation.isPending}
        >
          End Downtime
        </Button>
      ) : (
        <Button
          variant="outline"
          onClick={() => startMutation.mutate()}
          disabled={startMutation.isPending}
        >
          Record Downtime
        </Button>
      )}
      <input type="hidden" value={assetId} readOnly />
    </Section>
  );
}

function PartsSection({
  workOrderId,
  parts,
  onChanged,
}: {
  workOrderId: string;
  parts: MaintenancePartUsage[];
  onChanged: () => void;
}) {
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [issuingId, setIssuingId] = useState<string | null>(null);
  const [issueLocationId, setIssueLocationId] = useState('');
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
    mutationFn: ({ partUsageId, locationId }: { partUsageId: string; locationId: string }) =>
      issuePartUsage(partUsageId, { locationId, issueIdempotencyKey: crypto.randomUUID() }),
    onSuccess: () => {
      setIssuingId(null);
      setIssueLocationId('');
      onChanged();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (partUsageId: string) => cancelPartUsage(partUsageId),
    onSuccess: onChanged,
  });

  return (
    <Section title="Parts Used">
      {parts.length === 0 ? (
        <p className="mb-3 text-sm text-muted-foreground">No parts recorded.</p>
      ) : (
        <ul className="mb-3 space-y-3 text-sm">
          {parts.map((p) => (
            <li key={p.id} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {productsById.get(p.productId)?.name ?? p.productId}
                </span>
                <Badge variant={PART_USAGE_STATUS_VARIANT[p.status]}>
                  {PART_USAGE_STATUS_LABELS[p.status]}
                </Badge>
              </div>
              <div className="mt-1 flex items-center justify-between text-muted-foreground">
                <span>
                  {p.quantity} {p.unitOfMeasure ?? ''}
                </span>
                {p.status === 'ISSUED' && p.totalCost !== null && (
                  <span>{formatCurrency(p.totalCost, 'NGN')}</span>
                )}
              </div>
              {p.status === 'REQUESTED' && (
                <div className="mt-2">
                  {issuingId === p.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={issueLocationId}
                        onChange={(event) => setIssueLocationId(event.target.value)}
                        className="min-w-[10rem] flex-1"
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
                        disabled={!issueLocationId || issueMutation.isPending}
                        onClick={() =>
                          issueMutation.mutate({ partUsageId: p.id, locationId: issueLocationId })
                        }
                      >
                        Confirm Issue
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setIssuingId(null)}>
                        Cancel
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
                        Cancel Request
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
          className="min-w-[10rem] flex-1"
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
          className="w-24"
        />
        <Button
          variant="outline"
          disabled={!productId || requestMutation.isPending}
          onClick={() => requestMutation.mutate()}
        >
          Request Part
        </Button>
      </div>
    </Section>
  );
}

function ProcurementSection({
  workOrderId,
  requirements,
  onChanged,
}: {
  workOrderId: string;
  requirements: MaintenanceProcurementRequirement[];
  onChanged: () => void;
}) {
  const [description, setDescription] = useState('');
  const [estimatedCost, setEstimatedCost] = useState('');
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [apSummaryId, setApSummaryId] = useState<string | null>(null);

  const { data: purchaseOrdersData } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => listPurchaseOrders(),
    enabled: linkingId !== null,
  });
  const { data: apSummary } = useQuery({
    queryKey: ['procurement-ap-summary', workOrderId, apSummaryId],
    queryFn: () => getProcurementApSummary(workOrderId, apSummaryId!),
    enabled: apSummaryId !== null,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createProcurementRequirement(workOrderId, {
        description,
        estimatedCost: estimatedCost ? Number(estimatedCost) : undefined,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: () => {
      setDescription('');
      setEstimatedCost('');
      onChanged();
    },
  });

  const linkMutation = useMutation({
    mutationFn: ({ id, poId }: { id: string; poId: string }) =>
      linkProcurementRequirement(workOrderId, id, poId),
    onSuccess: () => {
      setLinkingId(null);
      setPurchaseOrderId('');
      onChanged();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelProcurementRequirement(workOrderId, id),
    onSuccess: onChanged,
  });

  return (
    <Section title="Procurement">
      {requirements.length === 0 ? (
        <p className="mb-3 text-sm text-muted-foreground">No procurement needs identified.</p>
      ) : (
        <ul className="mb-3 space-y-3 text-sm">
          {requirements.map((r) => (
            <li key={r.id} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{r.description}</span>
                <Badge variant={PROCUREMENT_STATUS_VARIANT[r.status]}>
                  {PROCUREMENT_STATUS_LABELS[r.status]}
                </Badge>
              </div>
              {r.estimatedCost !== null && (
                <p className="mt-1 text-muted-foreground">
                  Estimated: {formatCurrency(r.estimatedCost, 'NGN')}
                </p>
              )}
              {r.status === 'IDENTIFIED' && (
                <div className="mt-2">
                  {linkingId === r.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={purchaseOrderId}
                        onChange={(event) => setPurchaseOrderId(event.target.value)}
                        className="min-w-[12rem] flex-1"
                      >
                        <option value="">Select purchase order…</option>
                        {(purchaseOrdersData?.items ?? []).map((po) => (
                          <option key={po.id} value={po.id}>
                            {po.purchaseOrderNumber} — {po.supplier.supplierName}
                          </option>
                        ))}
                      </Select>
                      <Button
                        size="sm"
                        disabled={!purchaseOrderId || linkMutation.isPending}
                        onClick={() => linkMutation.mutate({ id: r.id, poId: purchaseOrderId })}
                      >
                        Confirm Link
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setLinkingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setLinkingId(r.id)}>
                        Link Purchase Order
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={cancelMutation.isPending}
                        onClick={() => cancelMutation.mutate(r.id)}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {r.status === 'LINKED' && (
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setApSummaryId(apSummaryId === r.id ? null : r.id)}
                  >
                    {apSummaryId === r.id ? 'Hide AP Summary' : 'View AP Summary'}
                  </Button>
                  {apSummaryId === r.id && apSummary && (
                    <div className="mt-2 space-y-1 rounded-md bg-muted/50 p-2 text-xs">
                      {apSummary.applicable ? (
                        <>
                          <Field
                            label="Invoiced"
                            value={formatCurrency(apSummary.invoicedTotal ?? 0, 'NGN')}
                          />
                          <Field
                            label="Paid"
                            value={formatCurrency(apSummary.amountPaid ?? 0, 'NGN')}
                          />
                          <Field
                            label="Outstanding"
                            value={formatCurrency(apSummary.amountOutstanding ?? 0, 'NGN')}
                          />
                        </>
                      ) : (
                        <p className="text-muted-foreground">
                          {apSummary.reason ?? 'No supplier invoice yet.'}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="What part/service is needed?"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="min-w-[12rem] flex-1"
        />
        <Input
          type="number"
          min="0"
          step="0.01"
          placeholder="Est. cost"
          value={estimatedCost}
          onChange={(event) => setEstimatedCost(event.target.value)}
          className="w-32"
        />
        <Button
          variant="outline"
          disabled={!description.trim() || createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          Identify Procurement Need
        </Button>
      </div>
    </Section>
  );
}

function CostsSection({
  workOrderId,
  costs,
  totalCost,
  onChanged,
}: {
  workOrderId: string;
  costs: {
    id: string;
    category: string;
    description: string | null;
    quantity: number;
    unitCost: number;
    totalCost: number;
  }[];
  totalCost: number;
  onChanged: () => void;
}) {
  const [category, setCategory] = useState<MaintenanceCostCategory>('LABOUR');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitCost, setUnitCost] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      recordCost({
        workOrderId,
        category,
        description: description || undefined,
        quantity: Number(quantity),
        unitCost: Number(unitCost),
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: () => {
      setDescription('');
      setQuantity('1');
      setUnitCost('');
      onChanged();
    },
  });

  return (
    <Section title="Costs">
      {costs.length === 0 ? (
        <p className="mb-3 text-sm text-muted-foreground">No costs recorded.</p>
      ) : (
        <ul className="mb-3 space-y-2 text-sm">
          {costs.map((c) => (
            <li key={c.id} className="flex items-center justify-between">
              <span>
                {MAINTENANCE_COST_CATEGORY_LABELS[c.category as MaintenanceCostCategory]}
                {c.description ? ` — ${c.description}` : ''}
              </span>
              <span className="text-muted-foreground">{formatCurrency(c.totalCost, 'NGN')}</span>
            </li>
          ))}
          <li className="flex items-center justify-between border-t border-border pt-2 font-medium">
            <span>Total incl. issued parts (operational record — never an accounting balance)</span>
            <span>{formatCurrency(totalCost, 'NGN')}</span>
          </li>
        </ul>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select
          value={category}
          onChange={(event) => setCategory(event.target.value as MaintenanceCostCategory)}
        >
          {Object.entries(MAINTENANCE_COST_CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Input
          placeholder="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Input
          type="number"
          min="0"
          step="0.01"
          placeholder="Qty"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
        <Input
          type="number"
          min="0"
          step="0.01"
          placeholder="Unit cost"
          value={unitCost}
          onChange={(event) => setUnitCost(event.target.value)}
        />
      </div>
      <Button
        variant="outline"
        className="mt-2"
        disabled={!unitCost || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        Add Cost
      </Button>
    </Section>
  );
}

function PhotosSection({
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
    <Section title="Photos">
      {documents.length > 0 && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          {documents.map((doc) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={doc.id}
              src={doc.url}
              alt={doc.caption ?? doc.documentType}
              className="aspect-square rounded object-cover"
            />
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <label className="cursor-pointer rounded-md border border-border px-3 py-2 text-sm">
          Add Before Photo
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
        <label className="cursor-pointer rounded-md border border-border px-3 py-2 text-sm">
          Add After Photo
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
    </Section>
  );
}

function CompleteDialog({
  workOrderId,
  onOpenChange,
  onCompleted,
}: {
  workOrderId: string;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
}) {
  const [resolution, setResolution] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [meterReading, setMeterReading] = useState('');
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const mutation = useMutation({
    mutationFn: () =>
      completeWorkOrder(workOrderId, {
        resolution,
        rootCause: rootCause || undefined,
        correctiveAction: correctiveAction || undefined,
        meterReading: meterReading ? Number(meterReading) : undefined,
        idempotencyKey,
      }),
    onSuccess: onCompleted,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-md rounded-t-lg bg-background p-6 sm:rounded-lg">
        <h2 className="mb-4 text-lg font-semibold">Complete Work Order</h2>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label>Resolution</Label>
            <Textarea
              rows={3}
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Root Cause (optional)</Label>
            <Textarea
              rows={2}
              value={rootCause}
              onChange={(event) => setRootCause(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Corrective Action (optional)</Label>
            <Textarea
              rows={2}
              value={correctiveAction}
              onChange={(event) => setCorrectiveAction(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Meter Reading (optional)</Label>
            <Input
              type="number"
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
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={!resolution.trim() || mutation.isPending}>
              {mutation.isPending ? 'Completing…' : 'Complete'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
