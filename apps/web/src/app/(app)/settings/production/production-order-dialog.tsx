'use client';

import { useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
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
import { z } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { ApiError } from '@/lib/api-client';

import { listInventoryLocations } from '../inventory/api';
import {
  createProductionOrder,
  getBillOfMaterial,
  listBillOfMaterials,
  updateProductionOrder,
  type ProductionOrder,
} from './api';

const productionOrderFormSchema = z.object({
  billOfMaterialId: z.string().min(1, 'Bill of materials is required'),
  plannedQuantity: z
    .number({ invalid_type_error: 'Planned quantity is required' })
    .positive('Planned quantity must be greater than zero'),
  locationId: z.string().min(1, 'Location is required'),
  notes: z.string().optional(),
});

type ProductionOrderFormValues = z.infer<typeof productionOrderFormSchema>;

/**
 * Create Production Order dialog (Sprint 4.6 brief §6/§7) — and Edit, only reachable
 * while `status === DRAFT`. Selecting a bill of materials shows a live, client-side
 * "Material Requirements" preview (each component's quantity scaled by
 * `plannedQuantity / bom.yieldQuantity`) purely so the user sees what they're committing
 * to before saving — the server always recomputes and pins this same calculation
 * authoritatively at creation time (brief §7's snapshot rule), this preview is never sent
 * as-is. The bill of materials itself can never be changed once an order exists (brief:
 * pinned forever), so its `<select>` is disabled in edit mode.
 */
export function ProductionOrderDialog({
  productionOrder,
  onOpenChange,
  onSaved,
}: {
  productionOrder: ProductionOrder | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = productionOrder !== null;

  const { data: bomsData } = useQuery({
    queryKey: ['boms', 'ACTIVE'],
    queryFn: () => listBillOfMaterials({ status: 'ACTIVE' }),
  });
  const { data: locationsData } = useQuery({
    queryKey: ['inventory-locations'],
    queryFn: () => listInventoryLocations(),
  });
  const activeBoms = bomsData?.items ?? [];
  const activeLocations = (locationsData?.items ?? []).filter(
    (location) => location.status === 'ACTIVE',
  );

  const form = useForm<ProductionOrderFormValues>({
    resolver: zodResolver(productionOrderFormSchema),
    defaultValues: {
      billOfMaterialId: productionOrder?.billOfMaterial.id ?? '',
      plannedQuantity: productionOrder?.plannedQuantity ?? 1,
      locationId: productionOrder?.location.id ?? '',
      notes: productionOrder?.notes ?? '',
    },
  });

  // The Bill of Materials `<select>` for an existing order is uncontrolled (RHF
  // `register`), so its initial selected option is only set once the ACTIVE-boms query
  // resolves — the order's own (now-superseded) bom may not even be in that ACTIVE-only
  // list. `form.reset` re-syncs the field once the query lands, same race avoided by
  // `PurchaseOrderDialog` waiting on its supplier/product queries.
  useEffect(() => {
    if (isEdit && bomsData) {
      form.reset({
        billOfMaterialId: productionOrder.billOfMaterial.id,
        plannedQuantity: productionOrder.plannedQuantity,
        locationId: productionOrder.location.id,
        notes: productionOrder.notes ?? '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bomsData]);

  const billOfMaterialId = form.watch('billOfMaterialId');
  const plannedQuantity = form.watch('plannedQuantity');

  // A dedicated by-id fetch (not just the ACTIVE-boms list above) so the preview still
  // works in edit mode once the order's own bom has been superseded/deactivated and no
  // longer appears in `activeBoms`.
  const { data: selectedBom } = useQuery({
    queryKey: ['bom', billOfMaterialId],
    queryFn: () => getBillOfMaterial(billOfMaterialId),
    enabled: billOfMaterialId.length > 0,
  });

  const requirementPreview = useMemo(() => {
    if (!selectedBom || !Number.isFinite(plannedQuantity) || plannedQuantity <= 0) {
      return [];
    }
    return selectedBom.items.map((item) => ({
      name: item.componentProduct.name,
      unit: item.unitOfMeasure,
      quantity: (item.quantity * plannedQuantity) / selectedBom.yieldQuantity,
    }));
  }, [selectedBom, plannedQuantity]);

  const mutation = useMutation({
    mutationFn: (values: ProductionOrderFormValues) => {
      if (isEdit) {
        return updateProductionOrder(productionOrder.id, {
          plannedQuantity: values.plannedQuantity,
          locationId: values.locationId,
          notes: values.notes || undefined,
        });
      }
      return createProductionOrder({
        billOfMaterialId: values.billOfMaterialId,
        plannedQuantity: values.plannedQuantity,
        locationId: values.locationId,
        notes: values.notes || undefined,
      });
    },
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
  });

  if (!bomsData || !locationsData) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Production Order' : 'Create Production Order'}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit Production Order' : 'Create Production Order'}</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        {isEdit && (
          <p className="rounded-md border border-dashed border-border bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
            {productionOrder.productionOrderNumber}
          </p>
        )}

        <div className="space-y-1.5">
          <Label>Bill of Materials</Label>
          <Select disabled={isEdit} {...form.register('billOfMaterialId')}>
            <option value="">Select a bill of materials…</option>
            {isEdit && !activeBoms.some((bom) => bom.id === productionOrder.billOfMaterial.id) && (
              <option value={productionOrder.billOfMaterial.id}>
                {productionOrder.billOfMaterial.bomNumber} (no longer active)
              </option>
            )}
            {activeBoms.map((bom) => (
              <option key={bom.id} value={bom.id}>
                {bom.bomNumber} — {bom.product.name}
              </option>
            ))}
          </Select>
          {activeBoms.length === 0 && !isEdit && (
            <p className="text-xs text-muted-foreground">
              No active bills of materials — activate one on the Bills of Materials tab first.
            </p>
          )}
          {form.formState.errors.billOfMaterialId && (
            <p className="text-xs text-destructive">
              {form.formState.errors.billOfMaterialId.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Planned Quantity</Label>
          <Input
            type="number"
            step="any"
            min="0"
            {...form.register('plannedQuantity', { valueAsNumber: true })}
          />
          {form.formState.errors.plannedQuantity && (
            <p className="text-xs text-destructive">
              {form.formState.errors.plannedQuantity.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Production Location</Label>
          <Select {...form.register('locationId')}>
            <option value="">Select a location…</option>
            {activeLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
          {form.formState.errors.locationId && (
            <p className="text-xs text-destructive">{form.formState.errors.locationId.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Notes (optional)</Label>
          <Textarea rows={2} {...form.register('notes')} />
        </div>

        {requirementPreview.length > 0 && (
          <div className="space-y-2">
            <Label>Material Requirements Preview</Label>
            <p className="text-xs text-muted-foreground">
              Computed from the bill of materials — the server recalculates and pins this
              authoritatively when you save.
            </p>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Component</th>
                    <th className="px-3 py-2 font-medium">Required Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {requirementPreview.map((row, index) => (
                    <tr
                      key={`${row.name}-${index}`}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2">{row.name}</td>
                      <td className="px-3 py-2">
                        {Math.round(row.quantity * 1_000_000) / 1_000_000} {row.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to save production order.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Production Order'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
