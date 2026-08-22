'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Badge,
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
import { useFieldArray, useForm } from 'react-hook-form';

import { ApiError } from '@/lib/api-client';

import { listProducts } from '../products/api';
import {
  activateBillOfMaterial,
  createBillOfMaterial,
  deactivateBillOfMaterial,
  updateBillOfMaterial,
  type BillOfMaterial,
} from './api';
import { BOM_STATUS_LABELS, BOM_STATUS_VARIANT } from './labels';

/** Second line of defense behind the backend's own check (brief §4: a recipe references
 *  a Finished Product and consumes only these three input types) — same "frontend filter
 *  is a UX convenience, the backend is the source of truth" convention as
 *  `PurchaseOrderDialog`'s `PURCHASABLE_PRODUCT_TYPES`. */
const COMPONENT_PRODUCT_TYPES = ['RAW_MATERIAL', 'PACKAGING_MATERIAL', 'CONSUMABLE'];

const bomFormSchema = z.object({
  productId: z.string().min(1, 'Finished product is required'),
  name: z.string().optional(),
  yieldQuantity: z
    .number({ invalid_type_error: 'Yield quantity is required' })
    .positive('Yield quantity must be greater than zero'),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        componentProductId: z.string().min(1, 'Component is required'),
        quantity: z
          .number({ invalid_type_error: 'Quantity is required' })
          .positive('Quantity must be greater than zero'),
        unitOfMeasure: z.string().min(1, 'Unit of measure is required'),
        notes: z.string().optional(),
      }),
    )
    .min(1, 'At least one component is required')
    .refine(
      (items) => new Set(items.map((item) => item.componentProductId)).size === items.length,
      'Each component can only appear once',
    ),
});

type BomFormValues = z.infer<typeof bomFormSchema>;

/**
 * Reusable Create/Edit Bill of Materials dialog (Sprint 4.6 brief §4/§5). `bom === null`
 * is create mode. Only a `DRAFT` bill of materials can be edited (brief: a BOM that has
 * ever been active is superseded by creating a new one, never edited in place) — an
 * `ACTIVE`/`INACTIVE` bom renders every field disabled and adds Activate/Deactivate
 * actions to the footer instead of Save, same "everything locked, no separate view-only
 * component" convention as `PurchaseOrderDialog`.
 */
export function BillOfMaterialDialog({
  bom,
  onOpenChange,
  onSaved,
}: {
  bom: BillOfMaterial | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = bom !== null;
  const readOnly = isEdit && bom.status !== 'DRAFT';

  const { data: productsData } = useQuery({
    queryKey: ['products'],
    queryFn: () => listProducts(),
  });
  const products = productsData?.items ?? [];
  const finishedProducts = products.filter((product) => product.type === 'FINISHED_PRODUCT');
  const componentProducts = products.filter((product) =>
    COMPONENT_PRODUCT_TYPES.includes(product.type),
  );

  const form = useForm<BomFormValues>({
    resolver: zodResolver(bomFormSchema),
    defaultValues: {
      productId: bom?.product.id ?? '',
      name: bom?.name ?? '',
      yieldQuantity: bom?.yieldQuantity ?? 1,
      notes: bom?.notes ?? '',
      items: bom
        ? bom.items.map((item) => ({
            componentProductId: item.componentProduct.id,
            quantity: item.quantity,
            unitOfMeasure: item.unitOfMeasure,
            notes: item.notes ?? '',
          }))
        : [{ componentProductId: '', quantity: 1, unitOfMeasure: '', notes: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });

  const saveMutation = useMutation({
    mutationFn: (values: BomFormValues) => {
      const items = values.items.map((item) => ({
        componentProductId: item.componentProductId,
        quantity: item.quantity,
        unitOfMeasure: item.unitOfMeasure,
        notes: item.notes || undefined,
      }));
      if (isEdit) {
        return updateBillOfMaterial(bom.id, {
          name: values.name || undefined,
          yieldQuantity: values.yieldQuantity,
          notes: values.notes || undefined,
          items,
        });
      }
      return createBillOfMaterial({
        productId: values.productId,
        name: values.name || undefined,
        yieldQuantity: values.yieldQuantity,
        notes: values.notes || undefined,
        items,
      });
    },
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
  });

  const activateMutation = useMutation({
    mutationFn: () => activateBillOfMaterial(bom!.id),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: () => deactivateBillOfMaterial(bom!.id),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
  });

  const mutationError = saveMutation.error ?? activateMutation.error ?? deactivateMutation.error;
  const isPending =
    saveMutation.isPending || activateMutation.isPending || deactivateMutation.isPending;

  if (!productsData) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Bill of Materials' : 'Create Bill of Materials'}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? (bom.name ?? bom.bomNumber) : 'Create Bill of Materials'}
        </DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
      >
        {isEdit && (
          <div className="flex items-center gap-2">
            <p className="rounded-md border border-dashed border-border bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
              {bom.bomNumber}
            </p>
            <Badge variant={BOM_STATUS_VARIANT[bom.status]}>{BOM_STATUS_LABELS[bom.status]}</Badge>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Finished Product</Label>
          <Select disabled={isEdit || readOnly} {...form.register('productId')}>
            <option value="">Select a finished product…</option>
            {finishedProducts.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} ({product.unit})
              </option>
            ))}
          </Select>
          {form.formState.errors.productId && (
            <p className="text-xs text-destructive">{form.formState.errors.productId.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Name (optional)</Label>
          <Input
            disabled={readOnly}
            placeholder="e.g. Plantain Chips v1"
            {...form.register('name')}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Yield Quantity</Label>
          <p className="text-xs text-muted-foreground">
            This recipe produces this many units of the finished product&apos;s own unit of measure.
          </p>
          <Input
            type="number"
            step="any"
            min="0"
            disabled={readOnly}
            {...form.register('yieldQuantity', { valueAsNumber: true })}
          />
          {form.formState.errors.yieldQuantity && (
            <p className="text-xs text-destructive">
              {form.formState.errors.yieldQuantity.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Notes (optional)</Label>
          <Textarea rows={2} disabled={readOnly} {...form.register('notes')} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Components</Label>
            {!readOnly && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  append({ componentProductId: '', quantity: 1, unitOfMeasure: '', notes: '' })
                }
              >
                Add Row
              </Button>
            )}
          </div>
          {form.formState.errors.items?.message && (
            <p className="text-xs text-destructive">{form.formState.errors.items.message}</p>
          )}
          {form.formState.errors.items?.root?.message && (
            <p className="text-xs text-destructive">{form.formState.errors.items.root.message}</p>
          )}

          <div className="space-y-3">
            {fields.map((field, index) => {
              const itemErrors = form.formState.errors.items?.[index];
              return (
                <div key={field.id} className="space-y-2 rounded-md border border-border p-2">
                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Component</Label>
                      <Select
                        disabled={readOnly}
                        {...form.register(`items.${index}.componentProductId`)}
                      >
                        <option value="">Select a component…</option>
                        {componentProducts.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name} ({product.unit})
                          </option>
                        ))}
                      </Select>
                    </div>
                    {!readOnly && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={fields.length === 1}
                        onClick={() => remove(index)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  {itemErrors?.componentProductId && (
                    <p className="text-xs text-destructive">
                      {itemErrors.componentProductId.message}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Quantity</Label>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        disabled={readOnly}
                        {...form.register(`items.${index}.quantity`, { valueAsNumber: true })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Unit of Measure</Label>
                      <Input
                        disabled={readOnly}
                        placeholder="e.g. Kilogram"
                        {...form.register(`items.${index}.unitOfMeasure`)}
                      />
                    </div>
                  </div>
                  {(itemErrors?.quantity || itemErrors?.unitOfMeasure) && (
                    <p className="text-xs text-destructive">
                      {itemErrors.quantity?.message ?? itemErrors.unitOfMeasure?.message}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {mutationError && (
          <p className="text-sm text-destructive">
            {mutationError instanceof ApiError
              ? mutationError.message
              : 'Failed to save bill of materials.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {isEdit && bom.status === 'ACTIVE' && (
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => deactivateMutation.mutate()}
            >
              {deactivateMutation.isPending ? 'Deactivating…' : 'Deactivate'}
            </Button>
          )}
          {isEdit && bom.status !== 'ACTIVE' && (
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => activateMutation.mutate()}
            >
              {activateMutation.isPending ? 'Activating…' : 'Activate'}
            </Button>
          )}
          {!readOnly && (
            <Button type="submit" disabled={isPending}>
              {saveMutation.isPending
                ? 'Saving…'
                : isEdit
                  ? 'Save Changes'
                  : 'Create Bill of Materials'}
            </Button>
          )}
        </DialogFooter>
      </form>
    </Dialog>
  );
}
