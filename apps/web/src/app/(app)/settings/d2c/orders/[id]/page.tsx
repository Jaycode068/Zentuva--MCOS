'use client';

import { type ReactNode, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
} from '@zentuva/ui';

import { CommunicationHistoryList } from '@/components/app/d2c-communication-history';
import { ApiError } from '@/lib/api-client';

import {
  type CollectionPointFulfillmentSummary,
  type ConsumerWhatsAppDeliverySummary,
  type D2COrderSummary,
  type D2CPaymentSummary,
  getCollectionPointFulfillmentBySalesOrder,
  getD2COrder,
  listCommunicationsForOrder,
  listEligibleOutletsForReassignment,
  listPaymentsForOrder,
  reassignCollectionPoint,
} from '../../api';

/**
 * Sprint 39 — D2C Sales Administration & Operations Dashboard
 * (docs/domains/d2c.md). Composes THREE existing reads — `GET /sales/orders/:id`
 * (the order itself, unchanged), `GET /finance/payments?salesOrderId=...`
 * (payment history), and `GET /d2c/collection-point-fulfillments/by-sales-order/:id`
 * (collection status) — never a new aggregate "D2C order" entity. The only
 * mutation here is the admin-only Collection Point reassignment, narrowly
 * scoped server-side (`CollectionPointFulfillmentService.reassign`) to an
 * `ASSIGNED`/`PREPARING` fulfilment only.
 */
export default function D2COrderDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const queryClient = useQueryClient();
  const [reassignOpen, setReassignOpen] = useState(false);

  const {
    data: order,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['d2c-admin-order', id],
    queryFn: () => getD2COrder(id),
  });
  const { data: paymentsData } = useQuery({
    queryKey: ['d2c-admin-order-payments', id],
    queryFn: () => listPaymentsForOrder(id),
  });
  const { data: collectionData, refetch: refetchCollection } = useQuery({
    queryKey: ['d2c-admin-order-collection', id],
    queryFn: () => getCollectionPointFulfillmentBySalesOrder(id),
  });
  const communicationsQueryKey = ['d2c-admin-order-communications', id];
  const { data: communicationsData } = useQuery({
    queryKey: communicationsQueryKey,
    queryFn: () => listCommunicationsForOrder(id),
  });

  const payments = paymentsData?.items ?? [];
  const collection = collectionData?.item ?? null;
  const communications = communicationsData?.items ?? [];
  const canReassign =
    collection && (collection.status === 'ASSIGNED' || collection.status === 'PREPARING');

  if (isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  }
  if (isError || !order) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Order not found.'}
        </p>
        <a href="/settings/d2c/orders" className="mt-2 inline-block text-sm text-primary">
          ← Back to D2C Orders
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <a href="/settings/d2c/orders" className="text-sm text-primary">
          ← D2C Orders
        </a>
        <div className="mt-2 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{order.orderCode}</h1>
          <Badge>{order.status.replace(/_/g, ' ')}</Badge>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold">Consumer</h2>
          {order.consumer ? (
            <dl className="space-y-1 text-sm">
              <Row label="Name" value={order.consumer.fullName} />
              <Row label="Code" value={order.consumer.consumerCode} />
              <Row
                label=""
                value={
                  <a
                    href={`/settings/d2c/consumers?id=${order.consumer.id}`}
                    className="text-primary hover:underline"
                  >
                    View consumer profile →
                  </a>
                }
              />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No consumer on record.</p>
          )}
        </section>

        <section className="rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold">Order</h2>
          <dl className="space-y-1 text-sm">
            <Row label="Ordered" value={new Date(order.orderDate).toLocaleString()} />
            <Row label="Total" value={order.total.toLocaleString()} />
            <Row label="Created" value={new Date(order.createdAt).toLocaleString()} />
          </dl>
        </section>

        <section className="rounded-lg border border-border p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Items</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-1">Product</th>
                <th className="py-1">Qty</th>
                <th className="py-1">Fulfilled</th>
                <th className="py-1">Unit Price</th>
                <th className="py-1">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id} className="border-t border-border">
                  <td className="py-2">{item.product.name}</td>
                  <td className="py-2">
                    {item.quantity} {item.product.unit}
                  </td>
                  <td className="py-2 text-muted-foreground">{item.quantityFulfilled}</td>
                  <td className="py-2">{item.unitPrice.toLocaleString()}</td>
                  <td className="py-2">{item.lineTotal.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold">Payment History</h2>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payment recorded for this order.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {payments.map((payment) => (
                <li key={payment.id} className="flex items-center justify-between">
                  <span>
                    {payment.amount.toLocaleString()} {payment.currency} ·{' '}
                    {new Date(payment.paymentDate).toLocaleString()}
                  </span>
                  <Badge
                    variant={
                      payment.status === 'RECORDED'
                        ? 'success'
                        : payment.status === 'FAILED'
                          ? 'destructive'
                          : 'default'
                    }
                  >
                    {payment.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Collection Point</h2>
            {canReassign && (
              <Button size="sm" variant="outline" onClick={() => setReassignOpen(true)}>
                Reassign
              </Button>
            )}
          </div>
          {!collection ? (
            <p className="text-sm text-muted-foreground">Not yet assigned to a Collection Point.</p>
          ) : (
            <dl className="space-y-1 text-sm">
              <Row label="Outlet" value={collection.outletName} />
              <Row label="Status" value={<Badge>{collection.status.replace(/_/g, ' ')}</Badge>} />
              <Row label="Assigned" value={new Date(collection.assignedAt).toLocaleString()} />
              {collection.readyAt && (
                <Row label="Ready since" value={new Date(collection.readyAt).toLocaleString()} />
              )}
              {collection.collectedAt && (
                <Row label="Collected" value={new Date(collection.collectedAt).toLocaleString()} />
              )}
            </dl>
          )}
        </section>

        <section className="rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold">Communication History</h2>
          <CommunicationHistoryList
            items={communications}
            queryKeyToInvalidate={communicationsQueryKey}
          />
        </section>

        <section className="rounded-lg border border-border p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Operational Timeline</h2>
          <OrderTimeline
            order={order}
            payments={payments}
            collection={collection}
            communications={communications}
          />
        </section>
      </div>

      {reassignOpen && collection && (
        <ReassignDialog
          collectionPointFulfillmentId={collection.id}
          currentOutletId={collection.outletId}
          onOpenChange={setReassignOpen}
          onReassigned={() => {
            refetchCollection();
            queryClient.invalidateQueries({ queryKey: ['d2c-admin-order-collection', id] });
          }}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      {label && <dt className="text-muted-foreground">{label}</dt>}
      <dd className={label ? 'text-right' : 'w-full text-right'}>{value}</dd>
    </div>
  );
}

function ReassignDialog({
  collectionPointFulfillmentId,
  currentOutletId,
  onOpenChange,
  onReassigned,
}: {
  collectionPointFulfillmentId: string;
  currentOutletId: string;
  onOpenChange: (open: boolean) => void;
  onReassigned: () => void;
}) {
  const [outletId, setOutletId] = useState('');
  const { data } = useQuery({
    queryKey: ['d2c-eligible-reassignment-outlets'],
    queryFn: listEligibleOutletsForReassignment,
  });
  const outlets = (data?.items ?? []).filter((outlet) => outlet.id !== currentOutletId);

  const mutation = useMutation({
    mutationFn: () => reassignCollectionPoint(collectionPointFulfillmentId, outletId),
    onSuccess: () => {
      onReassigned();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Reassign Collection Point</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Moves this order to a different Collection Point and resets it to the start of the queue
          there. Only available while the order has not yet been marked ready for collection.
        </p>
        <Select value={outletId} onChange={(e) => setOutletId(e.target.value)}>
          <option value="">Select a Collection Point…</option>
          {outlets.map((outlet) => (
            <option key={outlet.id} value={outlet.id}>
              {outlet.name}
            </option>
          ))}
        </Select>
        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : 'Reassignment failed.'}
          </p>
        )}
        <DialogFooter>
          <Button disabled={!outletId || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Reassigning…' : 'Reassign'}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

interface TimelineStep {
  label: string;
  timestamp: string | null;
  detail?: string;
}

/**
 * Sprint 43 — D2C Operations, Notifications & Production Hardening (brief §Phase 8
 * "Order Operational Timeline"). Built ENTIRELY from real, already-fetched data this
 * page already loads for its own Order/Payment History/Collection Point/Communication
 * History sections — no new backend aggregation endpoint, no fabricated timeline
 * record. A step with no timestamp is rendered as "not yet" rather than omitted, so an
 * operator can see exactly where an order currently sits in the flow.
 */
function OrderTimeline({
  order,
  payments,
  collection,
  communications,
}: {
  order: D2COrderSummary;
  payments: D2CPaymentSummary[];
  collection: CollectionPointFulfillmentSummary | null;
  communications: ConsumerWhatsAppDeliverySummary[];
}) {
  const latestPayment = payments[0] ?? null;
  const confirmedPayment = payments.find((p) => p.status === 'RECORDED') ?? null;
  const readyNotification = communications.find((c) => c.kind === 'COLLECTION_READY') ?? null;
  const collectedNotification =
    communications.find((c) => c.kind === 'COLLECTION_CONFIRMED') ?? null;

  const steps: TimelineStep[] = [
    { label: 'Order Created', timestamp: order.createdAt },
    {
      label: 'Payment Initiated',
      timestamp: latestPayment?.createdAt ?? null,
      detail: latestPayment ? `${latestPayment.status}` : undefined,
    },
    {
      label: 'Payment Confirmed',
      timestamp: confirmedPayment?.paymentDate ?? null,
    },
    { label: 'Collection Point Assigned', timestamp: collection?.assignedAt ?? null },
    { label: 'Preparing Started', timestamp: collection?.preparingAt ?? null },
    { label: 'Ready for Collection', timestamp: collection?.readyAt ?? null },
    {
      label: 'Consumer Notified (Ready)',
      timestamp: readyNotification?.createdAt ?? null,
      detail: readyNotification ? readyNotification.status : undefined,
    },
    { label: 'Collection Confirmed', timestamp: collection?.collectedAt ?? null },
    {
      label: 'Consumer Notified (Collected)',
      timestamp: collectedNotification?.createdAt ?? null,
      detail: collectedNotification ? collectedNotification.status : undefined,
    },
  ];

  return (
    <ol className="space-y-3">
      {steps.map((step) => (
        <li key={step.label} className="flex items-start gap-3 text-sm">
          <span
            className={
              step.timestamp
                ? 'mt-1 h-2 w-2 shrink-0 rounded-full bg-primary'
                : 'mt-1 h-2 w-2 shrink-0 rounded-full border border-muted-foreground'
            }
          />
          <div className="flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className={step.timestamp ? 'font-medium' : 'text-muted-foreground'}>
                {step.label}
              </span>
              <span className="text-xs text-muted-foreground">
                {step.timestamp ? new Date(step.timestamp).toLocaleString() : 'Not yet'}
              </span>
            </div>
            {step.detail && <p className="text-xs text-muted-foreground">{step.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
