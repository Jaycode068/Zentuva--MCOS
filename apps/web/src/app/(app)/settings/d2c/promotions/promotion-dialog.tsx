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
import { useFieldArray, useForm } from 'react-hook-form';

import { ApiError } from '@/lib/api-client';

import { listTerritories } from '../../retail/api';
import { listProducts } from '../../products/api';
import { createPromotion, Promotion, PromotionConditionType, updatePromotion } from './api';

interface ConditionFormRow {
  type: PromotionConditionType;
  minOrderValue: string;
  productId: string;
  minQuantity: string;
  territoryId: string;
}

interface PromotionFormValues {
  name: string;
  description: string;
  startsAt: string;
  endsAt: string;
  conditions: ConditionFormRow[];
  benefitType: 'BONUS_POINTS' | 'FREE_PRODUCT';
  pointsValue: string;
  freeProductId: string;
  freeProductQuantity: string;
}

function toDateTimeInputValue(value: string | undefined): string {
  if (!value) return '';
  return value.slice(0, 16);
}

const EMPTY_CONDITION: ConditionFormRow = {
  type: 'FIRST_QUALIFYING_ORDER',
  minOrderValue: '',
  productId: '',
  minQuantity: '',
  territoryId: '',
};

/**
 * Sprint 40 — the Promotion authoring form (docs/domains/d2c.md "Critical Business
 * Requirement"). `promotion === null` is create mode (always starts `DRAFT`); otherwise
 * edit mode, which the backend itself rejects once the promotion has left `DRAFT` —
 * this form is simply disabled entirely for a non-draft promotion (`readOnly`) rather
 * than attempting to pre-empt that check client-side. A LOCAL, string-based form schema
 * (mirroring `purchase-order-dialog.tsx`'s own convention) — the server does the real
 * coercion/validation regardless.
 */
export function PromotionDialog({
  promotion,
  readOnly = false,
  onOpenChange,
  onSaved,
}: {
  promotion: Promotion | null;
  readOnly?: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (promotion: Promotion) => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const { data: territoriesData } = useQuery({
    queryKey: ['territories'],
    queryFn: () => listTerritories({ status: 'ACTIVE' }),
  });
  const { data: productsData } = useQuery({
    queryKey: ['products-for-promotions'],
    queryFn: () => listProducts(),
  });
  const territories = territoriesData?.items ?? [];
  const products = productsData?.items ?? [];

  const existingBenefit = promotion?.benefits[0];
  const form = useForm<PromotionFormValues>({
    defaultValues: {
      name: promotion?.name ?? '',
      description: promotion?.description ?? '',
      startsAt: toDateTimeInputValue(promotion?.startsAt),
      endsAt: toDateTimeInputValue(promotion?.endsAt),
      conditions: promotion?.conditions.length
        ? promotion.conditions.map((c) => ({
            type: c.type,
            minOrderValue: c.minOrderValue?.toString() ?? '',
            productId: c.productId ?? '',
            minQuantity: c.minQuantity?.toString() ?? '',
            territoryId: c.territoryId ?? '',
          }))
        : [EMPTY_CONDITION],
      benefitType: existingBenefit?.type ?? 'BONUS_POINTS',
      pointsValue: existingBenefit?.pointsValue?.toString() ?? '',
      freeProductId: existingBenefit?.freeProductId ?? '',
      freeProductQuantity: existingBenefit?.freeProductQuantity?.toString() ?? '',
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'conditions' });

  const mutation = useMutation({
    mutationFn: (values: PromotionFormValues) => {
      const conditions = values.conditions.map((c) => {
        if (c.type === 'MINIMUM_ORDER_VALUE') {
          return { type: c.type, minOrderValue: Number(c.minOrderValue) };
        }
        if (c.type === 'PRODUCT_QUANTITY') {
          return { type: c.type, productId: c.productId, minQuantity: Number(c.minQuantity) };
        }
        if (c.type === 'TERRITORY') {
          return { type: c.type, territoryId: c.territoryId };
        }
        return { type: c.type as 'FIRST_QUALIFYING_ORDER' };
      });
      const benefit =
        values.benefitType === 'BONUS_POINTS'
          ? { type: 'BONUS_POINTS' as const, pointsValue: Number(values.pointsValue) }
          : {
              type: 'FREE_PRODUCT' as const,
              freeProductId: values.freeProductId,
              freeProductQuantity: Number(values.freeProductQuantity),
            };

      const payload = {
        name: values.name,
        description: values.description || undefined,
        startsAt: new Date(values.startsAt),
        endsAt: new Date(values.endsAt),
        conditions,
        benefit,
      };
      return promotion ? updatePromotion(promotion.id, payload) : createPromotion(payload);
    },
    onSuccess: (saved) => onSaved(saved),
    onError: (error) =>
      setFormError(error instanceof ApiError ? error.message : 'Failed to save promotion.'),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{promotion ? promotion.name : 'New Promotion'}</DialogTitle>
      </DialogHeader>
      <form className="space-y-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input {...form.register('name', { required: true })} disabled={readOnly} />
        </div>
        <div className="space-y-1.5">
          <Label>Description (optional)</Label>
          <Textarea {...form.register('description')} disabled={readOnly} rows={2} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Starts</Label>
            <Input
              type="datetime-local"
              {...form.register('startsAt', { required: true })}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Ends</Label>
            <Input
              type="datetime-local"
              {...form.register('endsAt', { required: true })}
              disabled={readOnly}
            />
          </div>
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <Label>Eligibility Conditions</Label>
            {!readOnly && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => append(EMPTY_CONDITION)}
              >
                Add Condition
              </Button>
            )}
          </div>
          {fields.map((field, index) => {
            const type = form.watch(`conditions.${index}.type`);
            return (
              <div
                key={field.id}
                className="flex items-start gap-2 rounded-md border border-border p-2"
              >
                <Select
                  {...form.register(`conditions.${index}.type`)}
                  disabled={readOnly}
                  className="max-w-[12rem]"
                >
                  <option value="FIRST_QUALIFYING_ORDER">First qualifying order</option>
                  <option value="MINIMUM_ORDER_VALUE">Minimum order value</option>
                  <option value="PRODUCT_QUANTITY">Product quantity</option>
                  <option value="TERRITORY">Territory</option>
                </Select>
                {type === 'MINIMUM_ORDER_VALUE' && (
                  <Input
                    type="number"
                    placeholder="Minimum order value"
                    {...form.register(`conditions.${index}.minOrderValue`)}
                    disabled={readOnly}
                  />
                )}
                {type === 'PRODUCT_QUANTITY' && (
                  <>
                    <Select {...form.register(`conditions.${index}.productId`)} disabled={readOnly}>
                      <option value="">Select a product…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                    <Input
                      type="number"
                      placeholder="Min qty"
                      className="max-w-[6rem]"
                      {...form.register(`conditions.${index}.minQuantity`)}
                      disabled={readOnly}
                    />
                  </>
                )}
                {type === 'TERRITORY' && (
                  <Select {...form.register(`conditions.${index}.territoryId`)} disabled={readOnly}>
                    <option value="">Select a territory…</option>
                    {territories.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                )}
                {!readOnly && fields.length > 1 && (
                  <Button type="button" size="sm" variant="outline" onClick={() => remove(index)}>
                    Remove
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <Label>Benefit</Label>
          <Select {...form.register('benefitType')} disabled={readOnly}>
            <option value="BONUS_POINTS">Bonus points</option>
            <option value="FREE_PRODUCT">Free product</option>
          </Select>
          {form.watch('benefitType') === 'BONUS_POINTS' ? (
            <Input
              type="number"
              placeholder="Points value"
              {...form.register('pointsValue')}
              disabled={readOnly}
            />
          ) : (
            <div className="flex gap-2">
              <Select {...form.register('freeProductId')} disabled={readOnly}>
                <option value="">Select a product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Input
                type="number"
                placeholder="Quantity"
                className="max-w-[6rem]"
                {...form.register('freeProductQuantity')}
                disabled={readOnly}
              />
            </div>
          )}
        </div>

        {formError && <p className="text-sm text-destructive">{formError}</p>}

        {!readOnly && (
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : promotion ? 'Save Changes' : 'Create Promotion'}
            </Button>
          </DialogFooter>
        )}
      </form>
    </Dialog>
  );
}
