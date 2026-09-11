'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
} from '@zentuva/ui';

import { AssetTabs } from '@/components/app/asset-tabs';
import { ImageUploadCard } from '@/components/app/image-upload-card';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';
import { listCapitalProjects } from '@/app/(app)/settings/finance/api';
import { getAssetMaintenanceHistory } from '@/app/(app)/settings/maintenance/api';
import {
  MAINTENANCE_PRIORITY_LABELS,
  MAINTENANCE_PRIORITY_VARIANT,
  PART_USAGE_STATUS_LABELS,
  PART_USAGE_STATUS_VARIANT,
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_STATUS_VARIANT,
} from '@/app/(app)/settings/maintenance/labels';
import { listPurchaseOrders } from '@/app/(app)/settings/procurement/api';
import { listSuppliers } from '@/app/(app)/settings/suppliers/api';

import {
  type Asset,
  type AssetMeterType,
  type AssetTransition,
  addAssetDocument,
  createAssetMeter,
  getAsset,
  getAssetAuditHistory,
  getAssetChildren,
  listAssetCategories,
  listAssetDocuments,
  listAssetLocations,
  listAssetMeterReadings,
  listAssetMeters,
  listAssetMovements,
  listCustodianCandidates,
  recordAssetMeterReading,
  removeAssetDocument,
  removeAssetImage,
  transferAsset,
  transitionAsset,
  uploadAssetImage,
} from '../../api';
import {
  ASSET_ACQUISITION_TYPE_LABELS,
  ASSET_CONDITION_LABELS,
  ASSET_CONDITION_VARIANT,
  ASSET_DOCUMENT_TYPE_LABELS,
  ASSET_METER_TYPE_LABELS,
  ASSET_STATUS_LABELS,
  ASSET_STATUS_VARIANT,
  ASSET_TRANSITION_LABELS,
} from '../../labels';

const TRANSITION_BUTTONS: Partial<Record<Asset['status'], AssetTransition[]>> = {
  DRAFT: ['activate'],
  ACTIVE: ['commission'],
  IN_SERVICE: ['start-maintenance', 'take-out-of-service'],
  UNDER_MAINTENANCE: ['resume-service'],
  OUT_OF_SERVICE: ['return-to-service'],
};
const TERMINAL_ELIGIBLE_STATUSES = new Set([
  'ACTIVE',
  'IN_SERVICE',
  'UNDER_MAINTENANCE',
  'OUT_OF_SERVICE',
]);

/**
 * Asset detail (Sprint 20, docs/domains/assets.md) — Overview,
 * Identification, Acquisition, Warranty, Hierarchy, Meter, Movement
 * History, Documents, Audit History. Every reference (Supplier/Purchase
 * Order/Capital Project) is read-only — this page never modifies any of
 * them.
 */
export default function AssetDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const queryClient = useQueryClient();

  const { data: asset } = useQuery({ queryKey: ['asset', id], queryFn: () => getAsset(id) });
  const { data: categoriesData } = useQuery({
    queryKey: ['asset-categories'],
    queryFn: () => listAssetCategories(),
  });
  const { data: locationsData } = useQuery({
    queryKey: ['asset-locations'],
    queryFn: () => listAssetLocations(),
  });
  const { data: custodiansData } = useQuery({
    queryKey: ['asset-custodians'],
    queryFn: () => listCustodianCandidates(),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['asset', id] });
    queryClient.invalidateQueries({ queryKey: ['assets'] });
    queryClient.invalidateQueries({ queryKey: ['asset-children', id] });
    queryClient.invalidateQueries({ queryKey: ['asset-movements', id] });
    queryClient.invalidateQueries({ queryKey: ['asset-audit', id] });
  };

  const transitionMutation = useMutation({
    mutationFn: (transition: AssetTransition) => transitionAsset(id, transition),
    onSuccess: invalidateAll,
  });

  if (!asset) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-sm text-muted-foreground">Loading asset…</p>
      </main>
    );
  }

  const transitions = TRANSITION_BUTTONS[asset.status] ?? [];
  const canDisposeOrRetire = TERMINAL_ELIGIBLE_STATUSES.has(asset.status);
  const category = categoriesData?.items.find((c) => c.id === asset.categoryId);
  const location = locationsData?.items.find((l) => l.id === asset.locationId);
  const custodian = custodiansData?.items.find((u) => u.id === asset.custodianId);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{asset.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {asset.assetCode}
            {asset.assetTag ? ` · ${asset.assetTag}` : ''} · {category?.name ?? '—'}
          </p>
          {asset.description && (
            <p className="mt-2 text-sm text-muted-foreground">{asset.description}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={ASSET_STATUS_VARIANT[asset.status]}>
            {ASSET_STATUS_LABELS[asset.status]}
          </Badge>
          <Badge variant={ASSET_CONDITION_VARIANT[asset.condition]}>
            {ASSET_CONDITION_LABELS[asset.condition]}
          </Badge>
          {transitions.map((transition) => (
            <Button
              key={transition}
              onClick={() => transitionMutation.mutate(transition)}
              disabled={transitionMutation.isPending}
            >
              {ASSET_TRANSITION_LABELS[transition]}
            </Button>
          ))}
          {canDisposeOrRetire && (
            <>
              <Button
                variant="outline"
                onClick={() => transitionMutation.mutate('dispose')}
                disabled={transitionMutation.isPending}
              >
                Dispose
              </Button>
              <Button
                variant="outline"
                onClick={() => transitionMutation.mutate('retire')}
                disabled={transitionMutation.isPending}
              >
                Retire
              </Button>
            </>
          )}
        </div>
      </div>

      <AssetTabs />

      {transitionMutation.isError && (
        <p className="mb-6 text-sm text-destructive">
          {transitionMutation.error instanceof ApiError
            ? transitionMutation.error.message
            : 'Failed to update asset.'}
        </p>
      )}

      <OverviewSection
        asset={asset}
        location={location}
        custodian={custodian}
        onSaved={invalidateAll}
      />
      <IdentificationSection asset={asset} />
      <AcquisitionSection asset={asset} />
      <WarrantySection asset={asset} />
      <HierarchySection asset={asset} />
      <MeterSection assetId={id} />
      <MaintenanceSection assetId={id} />
      <MovementSection asset={asset} onSaved={invalidateAll} />
      <DocumentsSection assetId={id} />
      <AuditHistorySection assetId={id} />
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function OverviewSection({
  asset,
  location,
  custodian,
  onSaved,
}: {
  asset: Asset;
  location: { name: string } | undefined;
  custodian: { firstName: string; lastName: string } | undefined;
  onSaved: () => void;
}) {
  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadAssetImage(asset.id, file),
    onSuccess: onSaved,
  });
  const removeMutation = useMutation({
    mutationFn: () => removeAssetImage(asset.id),
    onSuccess: onSaved,
  });

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 max-w-xs">
          <ImageUploadCard
            title="Photo"
            description="Shown in the asset register and on this detail page."
            imageUrl={asset.imageUrl}
            fallbackInitials={asset.name.slice(0, 2).toUpperCase()}
            shape="square"
            onUpload={(file) => uploadMutation.mutate(file)}
            onRemove={() => removeMutation.mutate()}
            isUploading={uploadMutation.isPending}
            isRemoving={removeMutation.isPending}
            error={
              uploadMutation.error instanceof ApiError
                ? uploadMutation.error.message
                : removeMutation.error instanceof ApiError
                  ? removeMutation.error.message
                  : null
            }
          />
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Field label="Asset Code" value={asset.assetCode} />
          <Field label="Asset Tag" value={asset.assetTag ?? '—'} />
          <Field label="Location" value={location?.name ?? '—'} />
          <Field
            label="Custodian"
            value={custodian ? `${custodian.firstName} ${custodian.lastName}` : '—'}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function IdentificationSection({ asset }: { asset: Asset }) {
  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Identification</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Field label="Manufacturer" value={asset.manufacturer ?? '—'} />
          <Field label="Model" value={asset.model ?? '—'} />
          <Field label="Serial Number" value={asset.serialNumber ?? '—'} />
          <Field label="Year of Manufacture" value={asset.yearOfManufacture?.toString() ?? '—'} />
        </div>
      </CardContent>
    </Card>
  );
}

function AcquisitionSection({ asset }: { asset: Asset }) {
  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => listSuppliers(),
  });
  const { data: purchaseOrdersData } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => listPurchaseOrders(),
  });
  const { data: capitalProjectsData } = useQuery({
    queryKey: ['capital-projects'],
    queryFn: () => listCapitalProjects(),
  });

  const supplier = suppliersData?.items.find((s) => s.id === asset.supplierId);
  const purchaseOrder = purchaseOrdersData?.items.find((po) => po.id === asset.purchaseOrderId);
  const capitalProject = capitalProjectsData?.items.find((p) => p.id === asset.capitalProjectId);

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Acquisition</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Field
            label="Acquisition Type"
            value={ASSET_ACQUISITION_TYPE_LABELS[asset.acquisitionType]}
          />
          <Field
            label="Acquisition Date"
            value={
              asset.acquisitionDate ? new Date(asset.acquisitionDate).toLocaleDateString() : '—'
            }
          />
          <Field
            label="Acquisition Cost"
            value={
              asset.acquisitionCost !== null
                ? formatCurrency(asset.acquisitionCost, asset.currency)
                : '—'
            }
          />
          <Field
            label="Salvage Value"
            value={
              asset.salvageValue !== null ? formatCurrency(asset.salvageValue, asset.currency) : '—'
            }
          />
          <Field label="Supplier" value={supplier?.supplierName ?? '—'} />
          <Field label="Purchase Order" value={purchaseOrder?.purchaseOrderNumber ?? '—'} />
          <Field
            label="Capital Project"
            value={capitalProject ? `${capitalProject.projectCode} — ${capitalProject.name}` : '—'}
          />
          <Field
            label="Useful Life"
            value={asset.usefulLifeMonths ? `${asset.usefulLifeMonths} months` : '—'}
          />
        </div>
        {(asset.supplierId || asset.purchaseOrderId || asset.capitalProjectId) && (
          <p className="mt-3 text-xs text-muted-foreground">
            Read-only references — this page never modifies the Supplier, Purchase Order, or Capital
            Project it links to.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function WarrantySection({ asset }: { asset: Asset }) {
  const now = new Date();
  let warrantyLabel = 'No Warranty';
  let warrantyVariant: 'success' | 'destructive' | 'default' = 'default';
  if (asset.warrantyEndDate) {
    const end = new Date(asset.warrantyEndDate);
    if (end >= now) {
      warrantyLabel = 'Active';
      warrantyVariant = 'success';
    } else {
      warrantyLabel = 'Expired';
      warrantyVariant = 'destructive';
    }
  }

  return (
    <Card className="mb-8">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">Warranty</CardTitle>
        <Badge variant={warrantyVariant}>{warrantyLabel}</Badge>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Field
            label="Start"
            value={
              asset.warrantyStartDate ? new Date(asset.warrantyStartDate).toLocaleDateString() : '—'
            }
          />
          <Field
            label="End"
            value={
              asset.warrantyEndDate ? new Date(asset.warrantyEndDate).toLocaleDateString() : '—'
            }
          />
          <Field label="Provider" value={asset.warrantyProvider ?? '—'} />
          <Field label="Reference" value={asset.warrantyReference ?? '—'} />
        </div>
      </CardContent>
    </Card>
  );
}

function HierarchySection({ asset }: { asset: Asset }) {
  const { data: parentAsset } = useQuery({
    queryKey: ['asset', asset.parentAssetId],
    queryFn: () => getAsset(asset.parentAssetId!),
    enabled: !!asset.parentAssetId,
  });
  const { data: childrenData } = useQuery({
    queryKey: ['asset-children', asset.id],
    queryFn: () => getAssetChildren(asset.id),
  });
  const children = childrenData?.items ?? [];

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Hierarchy</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3">
          <p className="text-xs text-muted-foreground">Parent</p>
          <p className="font-medium">
            {asset.parentAssetId ? (
              <a
                href={`/settings/assets/register/${asset.parentAssetId}`}
                className="text-primary hover:underline"
              >
                {parentAsset?.name ?? '…'}
              </a>
            ) : (
              '—'
            )}
          </p>
        </div>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Components / Children</p>
          {children.length === 0 ? (
            <p className="text-sm text-muted-foreground">No child components.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {children.map((child) => (
                <li key={child.id}>
                  <a
                    href={`/settings/assets/register/${child.id}`}
                    className="text-primary hover:underline"
                  >
                    {child.name}
                  </a>{' '}
                  <span className="text-xs text-muted-foreground">({child.assetCode})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MeterSection({ assetId }: { assetId: string }) {
  const queryClient = useQueryClient();
  const [meterType, setMeterType] = useState<AssetMeterType>('HOURS');
  const [unit, setUnit] = useState('hours');

  const { data: metersData } = useQuery({
    queryKey: ['asset-meters', assetId],
    queryFn: () => listAssetMeters(assetId),
  });
  const meters = metersData?.items ?? [];

  const addMeterMutation = useMutation({
    mutationFn: () => createAssetMeter(assetId, { meterType, unit }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['asset-meters', assetId] }),
  });

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Meter</CardTitle>
      </CardHeader>
      <CardContent>
        {meters.length === 0 && (
          <p className="mb-4 text-sm text-muted-foreground">No meters recorded yet.</p>
        )}
        {meters.map((meter) => (
          <MeterCard key={meter.id} assetId={assetId} meter={meter} />
        ))}

        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-3">
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Meter Type</label>
            <Select
              value={meterType}
              onChange={(event) => setMeterType(event.target.value as AssetMeterType)}
              className="h-8"
            >
              <option value="HOURS">Operating Hours</option>
              <option value="KILOMETERS">Kilometers</option>
              <option value="CYCLES">Cycles</option>
              <option value="UNITS">Units</option>
              <option value="OTHER">Other</option>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Unit</label>
            <Input
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              className="h-8 w-24"
            />
          </div>
          <Button
            size="sm"
            onClick={() => addMeterMutation.mutate()}
            disabled={addMeterMutation.isPending}
          >
            Add Meter
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MeterCard({
  assetId,
  meter,
}: {
  assetId: string;
  meter: {
    id: string;
    meterType: AssetMeterType;
    unit: string;
    currentReading: number;
    lastReadingDate: string | null;
  };
}) {
  const queryClient = useQueryClient();
  const [reading, setReading] = useState('');

  const { data: readingsData } = useQuery({
    queryKey: ['asset-meter-readings', meter.id],
    queryFn: () => listAssetMeterReadings(assetId, meter.id),
  });
  const readings = readingsData?.items ?? [];

  const recordMutation = useMutation({
    mutationFn: () =>
      recordAssetMeterReading(assetId, meter.id, {
        reading: Number(reading),
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: () => {
      setReading('');
      queryClient.invalidateQueries({ queryKey: ['asset-meter-readings', meter.id] });
      queryClient.invalidateQueries({ queryKey: ['asset-meters', assetId] });
    },
  });

  return (
    <div className="mb-4 rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium">
          {ASSET_METER_TYPE_LABELS[meter.meterType]} ({meter.unit})
        </p>
        <p className="text-sm font-semibold">
          {meter.currentReading.toLocaleString()} {meter.unit}
        </p>
      </div>
      <div className="mb-2 flex items-end gap-2">
        <Input
          type="number"
          value={reading}
          onChange={(event) => setReading(event.target.value)}
          className="h-8 w-32"
          placeholder="New reading"
        />
        <Button
          size="sm"
          onClick={() => recordMutation.mutate()}
          disabled={!reading || recordMutation.isPending}
        >
          Record
        </Button>
      </div>
      {recordMutation.isError && (
        <p className="mb-2 text-xs text-destructive">
          {recordMutation.error instanceof ApiError
            ? recordMutation.error.message
            : 'Failed to record reading.'}
        </p>
      )}
      {readings.length > 0 && (
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 pr-3 font-medium">Date</th>
              <th className="py-1 pr-3 text-right font-medium">Reading</th>
            </tr>
          </thead>
          <tbody>
            {readings.map((r) => (
              <tr key={r.id} className="border-t border-border/60">
                <td className="py-1 pr-3">{new Date(r.readingDate).toLocaleDateString()}</td>
                <td className="py-1 pr-3 text-right">{r.reading.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MovementSection({ asset, onSaved }: { asset: Asset; onSaved: () => void }) {
  const [transferOpen, setTransferOpen] = useState(false);
  const [newLocationId, setNewLocationId] = useState('');
  const [newCustodianId, setNewCustodianId] = useState('');
  const [reason, setReason] = useState('');

  const { data: locationsData } = useQuery({
    queryKey: ['asset-locations'],
    queryFn: () => listAssetLocations(),
  });
  const { data: custodiansData } = useQuery({
    queryKey: ['asset-custodians'],
    queryFn: () => listCustodianCandidates(),
  });
  const { data: movementsData } = useQuery({
    queryKey: ['asset-movements', asset.id],
    queryFn: () => listAssetMovements(asset.id),
  });
  const movements = movementsData?.items ?? [];
  const locationsById = new Map((locationsData?.items ?? []).map((l) => [l.id, l.name]));

  const transferMutation = useMutation({
    mutationFn: () =>
      transferAsset(asset.id, {
        newLocationId: newLocationId || undefined,
        newCustodianId: newCustodianId || undefined,
        reason: reason || undefined,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: () => {
      setTransferOpen(false);
      setNewLocationId('');
      setNewCustodianId('');
      setReason('');
      onSaved();
    },
  });

  const terminal = asset.status === 'DISPOSED' || asset.status === 'RETIRED';

  return (
    <Card className="mb-8">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Movement History
        </CardTitle>
        {!terminal && (
          <Button size="sm" variant="outline" onClick={() => setTransferOpen((open) => !open)}>
            Transfer
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {transferOpen && (
          <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-3">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">New Location</label>
              <Select
                value={newLocationId}
                onChange={(event) => setNewLocationId(event.target.value)}
                className="h-8"
              >
                <option value="">Unchanged</option>
                {(locationsData?.items ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">New Custodian</label>
              <Select
                value={newCustodianId}
                onChange={(event) => setNewCustodianId(event.target.value)}
                className="h-8"
              >
                <option value="">Unchanged</option>
                {(custodiansData?.items ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.firstName} {u.lastName}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Reason</label>
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="h-8 w-40"
              />
            </div>
            <Button
              size="sm"
              onClick={() => transferMutation.mutate()}
              disabled={(!newLocationId && !newCustodianId) || transferMutation.isPending}
            >
              Confirm Transfer
            </Button>
          </div>
        )}
        {transferMutation.isError && (
          <p className="mb-3 text-xs text-destructive">
            {transferMutation.error instanceof ApiError
              ? transferMutation.error.message
              : 'Failed to transfer asset.'}
          </p>
        )}
        {movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">No movements recorded yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">Date</th>
                <th className="py-1 pr-3 font-medium">Previous Location</th>
                <th className="py-1 pr-3 font-medium">New Location</th>
                <th className="py-1 pr-3 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id} className="border-t border-border/60">
                  <td className="py-1 pr-3">{new Date(m.effectiveAt).toLocaleString()}</td>
                  <td className="py-1 pr-3">
                    {m.previousLocationId ? (locationsById.get(m.previousLocationId) ?? '—') : '—'}
                  </td>
                  <td className="py-1 pr-3">
                    {m.newLocationId ? (locationsById.get(m.newLocationId) ?? '—') : '—'}
                  </td>
                  <td className="py-1 pr-3 text-muted-foreground">{m.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function DocumentsSection({ assetId }: { assetId: string }) {
  const queryClient = useQueryClient();
  const [documentType, setDocumentType] = useState<
    'PHOTO' | 'INVOICE' | 'WARRANTY_DOCUMENT' | 'MANUAL' | 'CERTIFICATE' | 'REGISTRATION' | 'OTHER'
  >('OTHER');

  const { data } = useQuery({
    queryKey: ['asset-documents', assetId],
    queryFn: () => listAssetDocuments(assetId),
  });
  const documents = data?.items ?? [];

  const addMutation = useMutation({
    mutationFn: (file: File) => addAssetDocument(assetId, file, documentType),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['asset-documents', assetId] }),
  });
  const removeMutation = useMutation({
    mutationFn: (documentId: string) => removeAssetDocument(assetId, documentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['asset-documents', assetId] }),
  });

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Documents</CardTitle>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="mb-3 text-sm text-muted-foreground">No documents attached yet.</p>
        ) : (
          <ul className="mb-3 space-y-1 text-sm">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between border-t border-border/60 pt-2 first:border-0 first:pt-0"
              >
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  {doc.fileName ?? ASSET_DOCUMENT_TYPE_LABELS[doc.documentType]}
                </a>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {ASSET_DOCUMENT_TYPE_LABELS[doc.documentType]}
                  <button
                    type="button"
                    onClick={() => removeMutation.mutate(doc.id)}
                    className="hover:text-destructive"
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-3">
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Document Type</label>
            <Select
              value={documentType}
              onChange={(event) => setDocumentType(event.target.value as typeof documentType)}
              className="h-8"
            >
              {Object.entries(ASSET_DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <label className="cursor-pointer text-xs text-primary hover:underline">
            {addMutation.isPending ? 'Uploading…' : 'Add Document'}
            <input
              type="file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) addMutation.mutate(file);
              }}
            />
          </label>
        </div>
      </CardContent>
    </Card>
  );
}

function AuditHistorySection({ assetId }: { assetId: string }) {
  const { data } = useQuery({
    queryKey: ['asset-audit', assetId],
    queryFn: () => getAssetAuditHistory(assetId),
  });
  const items = data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Audit History</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No state-changing actions recorded yet.</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {items.map((event) => (
              <li
                key={event.id}
                className="flex items-center justify-between border-t border-border/60 pt-2"
              >
                <span className="font-medium">{event.action}</span>
                <span className="text-muted-foreground">
                  {new Date(event.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function formatDowntimeMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m`;
}

/** Composes Sprint 21/22's own Maintenance domain, read-only — never
 *  duplicates the full Work Order table, the parts/inventory ledger, or
 *  the schedule engine; always links out to `/settings/maintenance/*` for
 *  the full picture (docs/domains/maintenance-integration.md "Asset
 *  Integration"). Every figure here is either read directly off
 *  `getAssetMaintenanceHistory()`'s own server-computed fields or a plain
 *  client-side filter/count over an array that endpoint already returned
 *  in full — the same "light display aggregation only" discipline the
 *  page's own pre-existing `openWorkOrders` line already followed. */
function MaintenanceSection({ assetId }: { assetId: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['asset-maintenance-history', assetId],
    queryFn: () => getAssetMaintenanceHistory(assetId),
  });

  const now = new Date();
  const openWorkOrders = (data?.workOrders ?? []).filter((wo) =>
    ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'].includes(wo.status),
  );
  const inProgressWorkOrders = (data?.workOrders ?? []).filter((wo) => wo.status === 'IN_PROGRESS');
  const overdueWorkOrders = openWorkOrders.filter(
    (wo) => wo.plannedEndAt && new Date(wo.plannedEndAt) < now,
  );
  const overdueSchedules = (data?.upcomingSchedules ?? []).filter(
    (s) => s.nextDueDate && new Date(s.nextDueDate) < now,
  );
  const totalDowntimeMinutes = (data?.downtimes ?? []).reduce(
    (sum, d) => sum + (d.durationMinutes ?? 0),
    0,
  );

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Maintenance</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>}
        {isError && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-destructive">
              {error instanceof ApiError ? error.message : 'Failed to load maintenance data.'}
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        )}
        {!isLoading && !isError && data && (
          <>
            {data.workOrders.length === 0 &&
            data.downtimes.length === 0 &&
            data.upcomingSchedules.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No maintenance activity recorded for this asset yet.
              </p>
            ) : (
              <>
                {/* Summary */}
                <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Field label="Open Work Orders" value={String(openWorkOrders.length)} />
                  <Field label="In Progress" value={String(inProgressWorkOrders.length)} />
                  <Field
                    label="Overdue"
                    value={String(overdueWorkOrders.length + overdueSchedules.length)}
                  />
                  <Field
                    label="Last Completed"
                    value={
                      data.lastMaintenance?.completedAt
                        ? new Date(data.lastMaintenance.completedAt).toLocaleDateString()
                        : '—'
                    }
                  />
                  <Field
                    label="Next Scheduled"
                    value={
                      data.nextScheduledMaintenance?.nextDueDate
                        ? new Date(data.nextScheduledMaintenance.nextDueDate).toLocaleDateString()
                        : '—'
                    }
                  />
                  <Field label="Total Cost" value={formatCurrency(data.totalCost, 'NGN')} />
                  <Field
                    label="Total Downtime"
                    value={
                      totalDowntimeMinutes > 0
                        ? formatDowntimeMinutes(totalDowntimeMinutes)
                        : '0h 0m'
                    }
                  />
                  <Field label="Total Work Orders" value={String(data.workOrders.length)} />
                </div>

                {data.capitalProject && (
                  <p className="mb-4 text-xs text-muted-foreground">
                    Originating capital project:{' '}
                    <a
                      href={`/settings/finance/capital-projects/${data.capitalProject.id}`}
                      className="text-primary hover:underline"
                    >
                      {data.capitalProject.projectCode} — {data.capitalProject.name}
                    </a>
                  </p>
                )}

                {/* Maintenance History */}
                {data.workOrders.length > 0 && (
                  <div className="mb-6">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Recent Maintenance History
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-left text-muted-foreground">
                          <tr>
                            <th className="py-1.5 pr-3 font-medium">Work Order</th>
                            <th className="py-1.5 pr-3 font-medium">Status</th>
                            <th className="py-1.5 pr-3 font-medium">Priority</th>
                            <th className="py-1.5 text-right font-medium">Completed</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.workOrders.slice(0, 8).map((wo) => (
                            <tr key={wo.id} className="border-t border-border">
                              <td className="py-1.5 pr-3">
                                <a
                                  href={`/settings/maintenance/work-orders/${wo.id}`}
                                  className="text-primary hover:underline"
                                >
                                  {wo.workOrderCode} — {wo.title}
                                </a>
                              </td>
                              <td className="py-1.5 pr-3">
                                <Badge variant={WORK_ORDER_STATUS_VARIANT[wo.status]}>
                                  {WORK_ORDER_STATUS_LABELS[wo.status]}
                                </Badge>
                              </td>
                              <td className="py-1.5 pr-3">
                                <Badge variant={MAINTENANCE_PRIORITY_VARIANT[wo.priority]}>
                                  {MAINTENANCE_PRIORITY_LABELS[wo.priority]}
                                </Badge>
                              </td>
                              <td className="py-1.5 text-right text-muted-foreground">
                                {wo.completedAt
                                  ? new Date(wo.completedAt).toLocaleDateString()
                                  : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <a
                      href={`/settings/maintenance/work-orders?assetId=${assetId}`}
                      className="mt-2 inline-block text-xs text-primary hover:underline"
                    >
                      View all {data.workOrders.length} work order(s) →
                    </a>
                  </div>
                )}

                {/* Parts Used */}
                {data.partsUsed.length > 0 && (
                  <div className="mb-6">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Parts Used ({data.partsIssuedCount} issued,{' '}
                      {formatCurrency(data.partsCost, 'NGN')})
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-left text-muted-foreground">
                          <tr>
                            <th className="py-1.5 pr-3 font-medium">Part</th>
                            <th className="py-1.5 pr-3 font-medium">Qty</th>
                            <th className="py-1.5 pr-3 font-medium">Status</th>
                            <th className="py-1.5 pr-3 font-medium">Work Order</th>
                            <th className="py-1.5 text-right font-medium">Cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.partsUsed.slice(0, 8).map((p) => (
                            <tr key={p.id} className="border-t border-border">
                              <td className="py-1.5 pr-3">{p.product.name}</td>
                              <td className="py-1.5 pr-3">
                                {p.quantity} {p.unitOfMeasure ?? ''}
                              </td>
                              <td className="py-1.5 pr-3">
                                <Badge variant={PART_USAGE_STATUS_VARIANT[p.status]}>
                                  {PART_USAGE_STATUS_LABELS[p.status]}
                                </Badge>
                              </td>
                              <td className="py-1.5 pr-3">
                                <a
                                  href={`/settings/maintenance/work-orders/${p.workOrderId}`}
                                  className="text-primary hover:underline"
                                >
                                  View
                                </a>
                              </td>
                              <td className="py-1.5 text-right text-muted-foreground">
                                {p.totalCost !== null ? formatCurrency(p.totalCost, 'NGN') : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Downtime */}
                {data.downtimes.length > 0 && (
                  <div className="mb-6">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Downtime</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-left text-muted-foreground">
                          <tr>
                            <th className="py-1.5 pr-3 font-medium">Started</th>
                            <th className="py-1.5 pr-3 font-medium">Ended</th>
                            <th className="py-1.5 pr-3 font-medium">Duration</th>
                            <th className="py-1.5 text-right font-medium">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.downtimes.slice(0, 5).map((d) => (
                            <tr key={d.id} className="border-t border-border">
                              <td className="py-1.5 pr-3">
                                {new Date(d.startedAt).toLocaleString()}
                              </td>
                              <td className="py-1.5 pr-3">
                                {d.endedAt ? new Date(d.endedAt).toLocaleString() : 'Ongoing'}
                              </td>
                              <td className="py-1.5 pr-3">
                                {d.durationMinutes !== null
                                  ? formatDowntimeMinutes(d.durationMinutes)
                                  : '—'}
                              </td>
                              <td className="py-1.5 text-right text-muted-foreground">
                                {d.reason ?? '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Preventive Maintenance */}
                {data.upcomingSchedules.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Preventive Maintenance Schedules
                    </p>
                    <ul className="space-y-1.5">
                      {data.upcomingSchedules.map((s) => {
                        const overdue = s.nextDueDate && new Date(s.nextDueDate) < now;
                        return (
                          <li key={s.id} className="flex items-center justify-between text-sm">
                            <span>
                              {s.scheduleType === 'METER_BASED'
                                ? `Every ${s.meterInterval} ${s.meterType ?? ''}`.trim()
                                : `Every ${s.frequencyValue ?? '—'} ${s.frequencyUnit?.toLowerCase() ?? ''}`}
                            </span>
                            <span
                              className={overdue ? 'text-destructive' : 'text-muted-foreground'}
                            >
                              {s.nextDueDate
                                ? `Due ${new Date(s.nextDueDate).toLocaleDateString()}`
                                : s.nextDueMeterReading
                                  ? `Due at ${s.nextDueMeterReading}`
                                  : '—'}
                              {overdue ? ' (overdue)' : ''}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <a
                      href="/settings/maintenance/schedules"
                      className="mt-2 inline-block text-xs text-primary hover:underline"
                    >
                      Manage schedules →
                    </a>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
