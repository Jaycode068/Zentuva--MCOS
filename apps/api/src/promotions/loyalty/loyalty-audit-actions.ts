/**
 * Audit action strings for `LoyaltyAccount`/`LoyaltyLedgerEntry` (Sprint 40,
 * docs/domains/d2c.md). Same `<entity>.<event>` naming convention as every other
 * domain's `*_AUDIT_ACTIONS` map. A system-triggered `EARN` entry (from a reward grant)
 * is NOT audited here — `REWARD_GRANT_AUDIT_ACTIONS.GRANTED` already covers it (see
 * `RewardGrantService`); only the human-triggered administrative mutation is.
 */
export const LOYALTY_AUDIT_ACTIONS = {
  BALANCE_ADJUSTED: 'loyalty_account.balance_adjusted',
} as const;
