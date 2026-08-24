'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input, Select } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';

import {
  activateChartOfAccount,
  deactivateChartOfAccount,
  listChartOfAccounts,
  type AccountType,
  type ChartOfAccount,
} from '../api';
import { ACCOUNT_TYPE_LABELS } from '../labels';
import { AccountDialog } from './account-dialog';

interface AccountNode extends ChartOfAccount {
  children: AccountNode[];
}

/** Builds a parent/child tree from the flat list the API returns — a self-referential
 *  hierarchy of arbitrary depth (docs/domains/accounting.md), same shape as
 *  `Territory`'s own tree, just rendered here rather than resolved server-side. */
function buildTree(accounts: ChartOfAccount[]): AccountNode[] {
  const nodesById = new Map<string, AccountNode>(
    accounts.map((account) => [account.id, { ...account, children: [] }]),
  );
  const roots: AccountNode[] = [];
  for (const node of nodesById.values()) {
    if (node.parentId && nodesById.has(node.parentId)) {
      nodesById.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortByCode = (a: AccountNode, b: AccountNode) => a.code.localeCompare(b.code);
  const sortRecursively = (nodes: AccountNode[]) => {
    nodes.sort(sortByCode);
    nodes.forEach((node) => sortRecursively(node.children));
  };
  sortRecursively(roots);
  return roots;
}

/** Chart of Accounts (Sprint 7, docs/domains/accounting.md) — a tenant-defined,
 *  self-referential hierarchy. System accounts (`isSystemAccount`) are clearly badged
 *  and can never be deactivated — see `ChartOfAccountService.deactivate`. */
export default function ChartOfAccountsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | AccountType>('');
  const [activeFilter, setActiveFilter] = useState<'' | 'true' | 'false'>('');
  const [dialogState, setDialogState] = useState<
    { mode: 'create' } | { mode: 'edit'; account: ChartOfAccount } | null
  >(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['chart-of-accounts'],
    queryFn: () => listChartOfAccounts(),
  });
  const accounts = useMemo(() => data?.items ?? [], [data]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return accounts.filter((account) => {
      if (typeFilter && account.type !== typeFilter) return false;
      if (activeFilter && String(account.isActive) !== activeFilter) return false;
      if (!query) return true;
      return (
        account.code.toLowerCase().includes(query) || account.name.toLowerCase().includes(query)
      );
    });
  }, [accounts, search, typeFilter, activeFilter]);

  // The tree must be built from the FULL account list (never the filtered one) so a
  // matching child's ancestors still render as its visual path — filtering only
  // decides which rows are highlighted/kept, never breaks the hierarchy shape.
  const tree = useMemo(() => buildTree(accounts), [accounts]);
  const visibleIds = useMemo(() => new Set(filtered.map((a) => a.id)), [filtered]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });

  const activateMutation = useMutation({
    mutationFn: (id: string) => activateChartOfAccount(id),
    onSuccess: invalidate,
  });
  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivateChartOfAccount(id),
    onSuccess: invalidate,
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your organisation&apos;s own Chart of Accounts — the accounts every journal entry posts
            to.
          </p>
        </div>
        <Button onClick={() => setDialogState({ mode: 'create' })}>Create Account</Button>
      </div>

      <FinanceTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading accounts…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load accounts.'}
        </p>
      )}
      {(activateMutation.isError || deactivateMutation.isError) && (
        <p className="mb-4 text-sm text-destructive">
          {[activateMutation, deactivateMutation]
            .map((m) => (m.error instanceof ApiError ? m.error.message : undefined))
            .find(Boolean) ?? 'That action could not be completed.'}
        </p>
      )}

      {!isLoading && !isError && (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              placeholder="Search by code or name…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="max-w-sm"
            />
            <Select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}
              className="max-w-[10rem]"
            >
              <option value="">All types</option>
              {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Select
              value={activeFilter}
              onChange={(event) => setActiveFilter(event.target.value as typeof activeFilter)}
              className="max-w-[9rem]"
            >
              <option value="">All statuses</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </Select>
          </div>

          {tree.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No accounts yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b border-border bg-muted/50 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Account</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tree.map((node) => (
                    <AccountRows
                      key={node.id}
                      node={node}
                      depth={0}
                      visibleIds={visibleIds}
                      onEdit={(account) => setDialogState({ mode: 'edit', account })}
                      onActivate={(id) => activateMutation.mutate(id)}
                      onDeactivate={(id) => deactivateMutation.mutate(id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {dialogState && (
        <AccountDialog
          account={dialogState.mode === 'edit' ? dialogState.account : null}
          accounts={accounts}
          onOpenChange={() => setDialogState(null)}
          onSaved={() => {
            invalidate();
            setDialogState(null);
          }}
        />
      )}
    </main>
  );
}

function AccountRows({
  node,
  depth,
  visibleIds,
  onEdit,
  onActivate,
  onDeactivate,
}: {
  node: AccountNode;
  depth: number;
  visibleIds: Set<string>;
  onEdit: (account: ChartOfAccount) => void;
  onActivate: (id: string) => void;
  onDeactivate: (id: string) => void;
}) {
  const anyDescendantVisible = (n: AccountNode): boolean =>
    visibleIds.has(n.id) || n.children.some(anyDescendantVisible);
  if (!anyDescendantVisible(node)) return null;

  return (
    <>
      <tr className="border-b border-border last:border-0">
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={() => onEdit(node)}
            className="text-left hover:underline"
            style={{ paddingLeft: `${depth * 1.25}rem` }}
          >
            <span className="font-mono text-xs font-medium">{node.code}</span>
            <span className="ml-2">{node.name}</span>
          </button>
          {node.isSystemAccount && (
            <Badge variant="default" className="ml-2">
              System
            </Badge>
          )}
        </td>
        <td className="px-4 py-3 text-muted-foreground">{ACCOUNT_TYPE_LABELS[node.type]}</td>
        <td className="px-4 py-3">
          <Badge variant={node.isActive ? 'success' : 'destructive'}>
            {node.isActive ? 'Active' : 'Inactive'}
          </Badge>
        </td>
        <td className="px-4 py-3 text-right">
          {node.isActive ? (
            <Button
              variant="outline"
              size="sm"
              disabled={node.isSystemAccount}
              title={node.isSystemAccount ? 'System accounts cannot be deactivated' : undefined}
              onClick={() => onDeactivate(node.id)}
            >
              Deactivate
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => onActivate(node.id)}>
              Activate
            </Button>
          )}
        </td>
      </tr>
      {node.children.map((child) => (
        <AccountRows
          key={child.id}
          node={child}
          depth={depth + 1}
          visibleIds={visibleIds}
          onEdit={onEdit}
          onActivate={onActivate}
          onDeactivate={onDeactivate}
        />
      ))}
    </>
  );
}
