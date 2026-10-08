'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Textarea,
} from '@zentuva/ui';

import { D2cTabs } from '@/components/app/d2c-tabs';
import { Field, ReadOnlyField } from '@/components/app/settings-field';
import { ApiError } from '@/lib/api-client';

import {
  type D2CConversationCapability,
  type D2CConversationMessageKey,
  getD2CConversationConfig,
  getD2CConversationPreview,
  resetD2CConversationMessage,
  updateD2CConversationCapabilities,
  updateD2CConversationMessage,
  updateD2CConversationProfile,
} from './api';

const QUERY_KEY = ['d2c-conversation-config'];

/** Brief §Phase 13 — grouped the same way the brief's own suggested UI groups them;
 *  every key here must exist in the real `D2CConversationMessageKey` enum (enforced by
 *  TypeScript) — never an unsupported key inserted through the UI. */
const MESSAGE_GROUPS: { label: string; keys: D2CConversationMessageKey[] }[] = [
  { label: 'General', keys: ['WELCOME', 'MAIN_MENU_PROMPT', 'HELP', 'UNKNOWN_COMMAND'] },
  {
    label: 'Registration & Location',
    keys: ['ASK_NAME', 'REGISTRATION_COMPLETE', 'LOCATION_UPDATED'],
  },
  {
    label: 'Ordering & Payment',
    keys: ['ASK_QUANTITY', 'ORDER_CREATED', 'PAYMENT_SUCCESS', 'ORDER_CANCELLED'],
  },
  { label: 'Collection', keys: ['READY_FOR_COLLECTION', 'COLLECTION_CONFIRMED'] },
  { label: 'Account', keys: ['MY_ORDERS_EMPTY'] },
];

const MESSAGE_LABELS: Record<D2CConversationMessageKey, string> = {
  WELCOME: 'Welcome message',
  MAIN_MENU_PROMPT: 'Main menu prompt',
  HELP: 'Help response',
  UNKNOWN_COMMAND: "Didn't understand that",
  ASK_NAME: 'Ask for name',
  REGISTRATION_COMPLETE: 'Registration complete',
  LOCATION_UPDATED: 'Location updated',
  ASK_QUANTITY: 'Ask for quantity',
  ORDER_CREATED: 'Order created',
  PAYMENT_SUCCESS: 'Payment successful',
  MY_ORDERS_EMPTY: 'No orders yet',
  READY_FOR_COLLECTION: 'Ready for Collection',
  COLLECTION_CONFIRMED: 'Collection confirmed',
  ORDER_CANCELLED: 'Order cancelled',
};

const CAPABILITY_LABELS: Record<D2CConversationCapability, string> = {
  ORDER_SNACKS: 'Order Products',
  MY_ORDERS: 'My Orders',
  MY_REWARDS: 'My Rewards',
  MY_ACCOUNT: 'My Account',
  UPDATE_LOCATION: 'Update Location',
  HELP: 'Help',
};

/**
 * Sprint 44 — Tenant D2C Conversation Configuration (docs/domains/d2c.md "Tenant
 * Conversation Configuration"). Lets an authorized tenant administrator customize the
 * SHARED conversation engine's presentation for their own organisation — business
 * identity, welcome message, menu labels/ordering/enabled capabilities, and a curated
 * customer-facing message catalogue. The internal capability identifier (what gets
 * invoked) is NEVER exposed as editable here — only its display label, matching
 * `D2CConversationConfigService`'s own "label is not the command" boundary. The
 * conversation STATE MACHINE, business logic, and every domain service it calls remain
 * entirely platform-controlled, unaffected by anything on this page.
 */
export default function D2CConversationSettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: getD2CConversationConfig,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">D2C Conversation Settings</h1>
        <p className="text-sm text-muted-foreground">
          Customize how the shared WhatsApp conversation engine presents itself for your business —
          the underlying ordering, payment, rewards, and Collection Point capabilities stay exactly
          the same for every tenant; only the wording and menu here are yours to configure.
        </p>
      </div>

      <D2cTabs />

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load configuration.'}
        </p>
      )}

      {data && (
        <>
          <ProfileCard
            config={data}
            onSaved={() => queryClient.invalidateQueries({ queryKey: QUERY_KEY })}
          />
          <CapabilitiesCard
            config={data}
            onSaved={() => queryClient.invalidateQueries({ queryKey: QUERY_KEY })}
          />
          <MessagesCard
            config={data}
            onSaved={() => queryClient.invalidateQueries({ queryKey: QUERY_KEY })}
          />
          <PreviewCard />
        </>
      )}
    </div>
  );
}

function ProfileCard({
  config,
  onSaved,
}: {
  config: Awaited<ReturnType<typeof getD2CConversationConfig>>;
  onSaved: () => void;
}) {
  const [supportPhone, setSupportPhone] = useState(config.supportPhone.value ?? '');
  const [supportEmail, setSupportEmail] = useState(config.supportEmail.value ?? '');

  const mutation = useMutation({
    mutationFn: () =>
      updateD2CConversationProfile({
        supportPhone: supportPhone.trim() === '' ? null : supportPhone.trim(),
        supportEmail: supportEmail.trim() === '' ? null : supportEmail.trim(),
      }),
    onSuccess: onSaved,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conversation Profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ReadOnlyField label="Business Display Name" value={config.businessName} />
        <p className="text-xs text-muted-foreground">
          Edit your business name under Organisation Settings — it is reused here automatically.
        </p>
        <Field
          label={`Support Phone ${config.supportPhone.isCustomized ? '(customized)' : '(using organisation default)'}`}
        >
          <Input
            value={supportPhone}
            onChange={(e) => setSupportPhone(e.target.value)}
            placeholder="Leave blank to use your Organisation's own phone number"
          />
        </Field>
        <Field
          label={`Support Email ${config.supportEmail.isCustomized ? '(customized)' : '(using organisation default)'}`}
        >
          <Input
            value={supportEmail}
            onChange={(e) => setSupportEmail(e.target.value)}
            placeholder="Leave blank to use your Organisation's own support email"
          />
        </Field>
        {mutation.isError && (
          <p className="text-xs text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : 'Failed to save.'}
          </p>
        )}
        <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Saving…' : 'Save Profile'}
        </Button>
      </CardContent>
    </Card>
  );
}

function CapabilitiesCard({
  config,
  onSaved,
}: {
  config: Awaited<ReturnType<typeof getD2CConversationConfig>>;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState(config.capabilities);
  useEffect(() => setRows(config.capabilities), [config.capabilities]);

  const duplicateOrders = new Set(
    rows.map((r) => r.sortOrder).filter((order, i, all) => all.indexOf(order) !== i),
  );
  const enabledCount = rows.filter((r) => r.enabled).length;

  const mutation = useMutation({
    mutationFn: () =>
      updateD2CConversationCapabilities(
        rows.map((r) => ({
          capability: r.capability,
          enabled: r.enabled,
          displayLabel: r.displayLabel.trim() === '' ? null : r.displayLabel.trim(),
          sortOrder: r.sortOrder,
        })),
      ),
    onSuccess: onSaved,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Main Menu</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2">Enabled</th>
                <th className="py-2">Label</th>
                <th className="py-2">Order</th>
                <th className="py-2">Internal id</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((row) => (
                  <tr key={row.capability} className="border-b border-border/50">
                    <td className="py-2">
                      <Checkbox
                        checked={row.enabled}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((r) =>
                              r.capability === row.capability
                                ? { ...r, enabled: e.target.checked }
                                : r,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <Input
                        value={row.displayLabel}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((r) =>
                              r.capability === row.capability
                                ? { ...r, displayLabel: e.target.value }
                                : r,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <Input
                        type="number"
                        className="w-20"
                        value={row.sortOrder}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((r) =>
                              r.capability === row.capability
                                ? { ...r, sortOrder: Number(e.target.value) }
                                : r,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {CAPABILITY_LABELS[row.capability]}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {duplicateOrders.size > 0 && (
          <p className="text-xs text-destructive">
            Two capabilities cannot share the same menu position.
          </p>
        )}
        {enabledCount === 0 && (
          <p className="text-xs text-destructive">At least one capability must remain enabled.</p>
        )}
        {mutation.isError && (
          <p className="text-xs text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : 'Failed to save.'}
          </p>
        )}
        <Button
          size="sm"
          disabled={mutation.isPending || duplicateOrders.size > 0 || enabledCount === 0}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Saving…' : 'Save Menu'}
        </Button>
      </CardContent>
    </Card>
  );
}

function MessagesCard({
  config,
  onSaved,
}: {
  config: Awaited<ReturnType<typeof getD2CConversationConfig>>;
  onSaved: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer-Facing Messages</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {MESSAGE_GROUPS.map((group) => (
          <div key={group.label} className="space-y-3">
            <h3 className="text-sm font-semibold">{group.label}</h3>
            {group.keys.map((key) => {
              const message = config.messages.find((m) => m.messageKey === key);
              if (!message) return null;
              return <MessageRow key={key} message={message} onSaved={onSaved} />;
            })}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function MessageRow({
  message,
  onSaved,
}: {
  message: Awaited<ReturnType<typeof getD2CConversationConfig>>['messages'][number];
  onSaved: () => void;
}) {
  const [value, setValue] = useState(message.value);
  useEffect(() => setValue(message.value), [message.value]);

  const saveMutation = useMutation({
    mutationFn: () => updateD2CConversationMessage(message.messageKey, value),
    onSuccess: onSaved,
  });
  const resetMutation = useMutation({
    mutationFn: () => resetD2CConversationMessage(message.messageKey),
    onSuccess: onSaved,
  });

  return (
    <div className="space-y-1.5 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <Label2>{MESSAGE_LABELS[message.messageKey]}</Label2>
        {message.isCustomized ? (
          <Badge variant="success">Customized</Badge>
        ) : (
          <Badge variant="default">Platform default</Badge>
        )}
      </div>
      <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3} />
      {message.allowedVariables.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Supported variables: {message.allowedVariables.map((v) => `{{${v}}}`).join(', ')}
        </p>
      )}
      {(saveMutation.isError || resetMutation.isError) && (
        <p className="text-xs text-destructive">
          {(saveMutation.error ?? resetMutation.error) instanceof ApiError
            ? ((saveMutation.error ?? resetMutation.error) as ApiError).message
            : 'Failed to save.'}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          disabled={saveMutation.isPending || value === message.value}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? 'Saving…' : 'Save'}
        </Button>
        {message.isCustomized && (
          <Button
            size="sm"
            variant="outline"
            disabled={resetMutation.isPending}
            onClick={() => resetMutation.mutate()}
          >
            Reset to Default
          </Button>
        )}
      </div>
    </div>
  );
}

/** A plain label — avoids pulling in `@zentuva/ui`'s `Label` (meant to pair with a
 *  single form control via `htmlFor`) for this card's own "name + badge" heading row. */
function Label2({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-medium">{children}</p>;
}

function PreviewCard() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['d2c-conversation-preview'],
    queryFn: getD2CConversationPreview,
    enabled: false,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Conversation Preview</CardTitle>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? 'Loading…' : 'Refresh Preview'}
        </Button>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          This preview is generated by the EXACT same resolver the real conversation uses — not a
          separate simulation.
        </p>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {isError && (
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load preview.'}
          </p>
        )}
        {!data && !isLoading && !isError && (
          <p className="text-sm text-muted-foreground">
            Click &quot;Refresh Preview&quot; to generate one.
          </p>
        )}
        {data && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-4">
            {data.messages.map((message, index) => (
              <div key={index} className="rounded-lg bg-background px-3 py-2 text-sm shadow-sm">
                <p className="whitespace-pre-wrap">{message.text}</p>
                {'options' in message && (
                  <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm">
                    {message.options.map((option) => (
                      <li key={option.value}>{option.label}</li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
