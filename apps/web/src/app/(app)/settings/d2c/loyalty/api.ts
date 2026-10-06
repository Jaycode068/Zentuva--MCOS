import { apiFetch } from '@/lib/api-client';

/**
 * Sprint 40 — Configurable Promotions, Loyalty, Rewards & Consumer Incentives
 * (docs/domains/d2c.md). API client for the Loyalty admin surface — account/ledger
 * inspection plus the one administrative mutation (a reasoned adjustment).
 */

export interface LoyaltyAccount {
  id: string;
  consumerId: string;
  consumer: { id: string; consumerCode: string; fullName: string };
  balance: number;
  createdAt: string;
  updatedAt: string;
}

export interface LoyaltyLedgerEntry {
  id: string;
  loyaltyAccountId: string;
  consumerId: string;
  type: 'EARN' | 'ADJUSTMENT';
  amount: number;
  balanceAfter: number;
  reason: string | null;
  rewardGrantId: string | null;
  actorUserId: string | null;
  createdAt: string;
}

export interface ListLoyaltyAccountsResult {
  items: LoyaltyAccount[];
  total: number;
  page: number;
  pageSize: number;
}

export function listLoyaltyAccounts(
  params: { search?: string; page?: number; pageSize?: number } = {},
): Promise<ListLoyaltyAccountsResult> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value));
  });
  const qs = query.toString();
  return apiFetch<ListLoyaltyAccountsResult>(`/promotions/loyalty/accounts${qs ? `?${qs}` : ''}`);
}

export function getLoyaltyAccount(consumerId: string): Promise<{ account: LoyaltyAccount | null }> {
  return apiFetch<{ account: LoyaltyAccount | null }>(`/promotions/loyalty/accounts/${consumerId}`);
}

export function getLoyaltyLedger(
  consumerId: string,
  params: { page?: number; pageSize?: number } = {},
): Promise<{ items: LoyaltyLedgerEntry[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  const qs = query.toString();
  return apiFetch<{ items: LoyaltyLedgerEntry[]; total: number; page: number; pageSize: number }>(
    `/promotions/loyalty/accounts/${consumerId}/ledger${qs ? `?${qs}` : ''}`,
  );
}

export function adjustLoyaltyBalance(
  consumerId: string,
  amount: number,
  reason: string,
): Promise<LoyaltyLedgerEntry> {
  return apiFetch<LoyaltyLedgerEntry>(`/promotions/loyalty/accounts/${consumerId}/adjustments`, {
    method: 'POST',
    body: JSON.stringify({ amount, reason }),
  });
}
