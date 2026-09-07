'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
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
import { listCapitalProjects } from '@/app/(app)/settings/finance/api';
import { listPurchaseOrders } from '@/app/(app)/settings/procurement/api';
import { listSuppliers } from '@/app/(app)/settings/suppliers/api';

import {
  type AssetAcquisitionType,
  createAsset,
  listAssetCategories,
  listAssetLocations,
  listCustodianCandidates,
} from '../api';

/** "Add Asset" dialog (Sprint 20, docs/domains/assets.md) — the header
 *  only. `assetCode` is always server-generated; Committed/Actual figures
 *  (a future Sprint 21 concept) are never entered here. */
export function AssetDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [assetTag, setAssetTag] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [locationId, setLocationId] = useState('');
  const [custodianId, setCustodianId] = useState('');
  const [acquisitionType, setAcquisitionType] = useState<AssetAcquisitionType>('PURCHASE');
  const [acquisitionDate, setAcquisitionDate] = useState('');
  const [acquisitionCost, setAcquisitionCost] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [capitalProjectId, setCapitalProjectId] = useState('');
  const [warrantyEndDate, setWarrantyEndDate] = useState('');

  const { data: categoriesData } = useQuery({
    queryKey: ['asset-categories', 'ACTIVE'],
    queryFn: () => listAssetCategories({ status: 'ACTIVE' }),
  });
  const { data: locationsData } = useQuery({
    queryKey: ['asset-locations', 'ACTIVE'],
    queryFn: () => listAssetLocations({ status: 'ACTIVE' }),
  });
  const { data: custodiansData } = useQuery({
    queryKey: ['asset-custodians'],
    queryFn: () => listCustodianCandidates(),
  });
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

  const mutation = useMutation({
    mutationFn: () =>
      createAsset({
        name,
        description: description || undefined,
        categoryId,
        assetTag: assetTag || undefined,
        serialNumber: serialNumber || undefined,
        manufacturer: manufacturer || undefined,
        model: model || undefined,
        locationId: locationId || undefined,
        custodianId: custodianId || undefined,
        acquisitionType,
        acquisitionDate: acquisitionDate || undefined,
        acquisitionCost: acquisitionCost ? Number(acquisitionCost) : undefined,
        supplierId: supplierId || undefined,
        purchaseOrderId: purchaseOrderId || undefined,
        capitalProjectId: capitalProjectId || undefined,
        warrantyEndDate: warrantyEndDate || undefined,
        idempotencyKey,
      }),
    onSuccess: (asset) => onCreated(asset.id),
  });

  const canSubmit = name.trim().length > 0 && !!categoryId;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Add Asset</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
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
            placeholder="e.g. Industrial Air Compressor"
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

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">Select…</option>
              {(categoriesData?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Asset Tag (optional)</Label>
            <Input
              value={assetTag}
              onChange={(event) => setAssetTag(event.target.value)}
              placeholder="e.g. BB-UTIL-001"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Manufacturer (optional)</Label>
            <Input value={manufacturer} onChange={(event) => setManufacturer(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Model (optional)</Label>
            <Input value={model} onChange={(event) => setModel(event.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Serial Number (optional)</Label>
          <Input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Location (optional)</Label>
            <Select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">None</option>
              {(locationsData?.items ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Custodian (optional)</Label>
            <Select value={custodianId} onChange={(event) => setCustodianId(event.target.value)}>
              <option value="">None</option>
              {(custodiansData?.items ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.firstName} {u.lastName}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Acquisition Type</Label>
            <Select
              value={acquisitionType}
              onChange={(event) => setAcquisitionType(event.target.value as AssetAcquisitionType)}
            >
              <option value="PURCHASE">Purchase</option>
              <option value="CAPITAL_PROJECT">Capital Project</option>
              <option value="TRANSFER">Transfer</option>
              <option value="DONATION">Donation</option>
              <option value="LEASE">Lease</option>
              <option value="OTHER">Other</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Acquisition Date (optional)</Label>
            <Input
              type="date"
              value={acquisitionDate}
              onChange={(event) => setAcquisitionDate(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Acquisition Cost (optional)</Label>
            <Input
              type="number"
              value={acquisitionCost}
              onChange={(event) => setAcquisitionCost(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Supplier (optional)</Label>
          <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
            <option value="">None</option>
            {(suppliersData?.items ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.supplierName}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Purchase Order (optional)</Label>
          <Select
            value={purchaseOrderId}
            onChange={(event) => setPurchaseOrderId(event.target.value)}
          >
            <option value="">None</option>
            {(purchaseOrdersData?.items ?? []).map((po) => (
              <option key={po.id} value={po.id}>
                {po.purchaseOrderNumber} — {po.supplier.supplierName}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Capital Project (optional)</Label>
          <Select
            value={capitalProjectId}
            onChange={(event) => setCapitalProjectId(event.target.value)}
          >
            <option value="">None</option>
            {(capitalProjectsData?.items ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.projectCode} — {p.name}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            Read-only reference — never duplicates or modifies the project itself.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Warranty End Date (optional)</Label>
          <Input
            type="date"
            value={warrantyEndDate}
            onChange={(event) => setWarrantyEndDate(event.target.value)}
          />
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to create asset.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Add Asset'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
