'use client';

import { Badge, Button, Dialog, DialogFooter, DialogHeader, DialogTitle } from '@zentuva/ui';

import type { Product } from './api';
import { CATEGORY_LABELS, STATUS_VARIANT, TYPE_LABELS } from './labels';

/**
 * Read-only Product details view (Sprint 4.1 brief: "Create a read-only details drawer or
 * modal. No separate page required for MVP.") — built on the shared `Dialog` modal rather
 * than a new slide-in drawer primitive, since the brief explicitly allows either and this
 * avoids introducing a second modal pattern for one view.
 */
export function ProductViewDialog({
  product,
  onOpenChange,
}: {
  product: Product;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{product.displayName ?? product.name}</DialogTitle>
      </DialogHeader>

      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-sm">
        <div className="flex items-center gap-4">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- user-uploaded URL
            <img
              src={product.imageUrl}
              alt=""
              className="h-16 w-16 rounded-lg border border-border bg-background object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-brandPurple text-lg font-semibold text-brandPurple-foreground">
              {product.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <p className="font-mono text-xs text-muted-foreground">{product.code}</p>
            <Badge variant={STATUS_VARIANT[product.status]}>{product.status}</Badge>
          </div>
        </div>

        <DetailRow label="Product Name" value={product.name} />
        <DetailRow label="Display Name" value={product.displayName ?? '—'} />
        <DetailRow label="Category" value={CATEGORY_LABELS[product.category]} />
        <DetailRow label="Product Type" value={TYPE_LABELS[product.type]} />
        <DetailRow label="Unit of Measure" value={product.unit} />
        <DetailRow label="Short Description" value={product.shortDescription ?? '—'} />
        <DetailRow label="Long Description" value={product.longDescription ?? '—'} multiline />
        <DetailRow label="Created" value={new Date(product.createdAt).toLocaleString()} />
        <DetailRow label="Last Updated" value={new Date(product.updatedAt).toLocaleString()} />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function DetailRow({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={multiline ? 'whitespace-pre-wrap text-foreground' : 'text-foreground'}>
        {value}
      </p>
    </div>
  );
}
