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

import {
  createDebtFacility,
  listCapitalRequirements,
  listChartOfAccounts,
  listLenders,
  type DebtType,
  type RepaymentFrequency,
  type RepaymentMethod,
} from '../api';

/**
 * "Add Debt Facility" dialog (Sprint 17, docs/domains/debt-management.md
 * §6-8) — the financing agreement itself. `liabilityAccountId`/
 * `interestExpenseAccountId` are user-chosen non-system Chart of Accounts
 * rows (Path B, the exact Sprint 12 precedent) — never a single hard-coded
 * global loan account. A generated repayment schedule is created
 * server-side in the same transaction as the facility.
 */
export function DebtFacilityDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [lenderId, setLenderId] = useState('');
  const [name, setName] = useState('');
  const [debtType, setDebtType] = useState<DebtType>('TERM_LOAN');
  const [principalAmount, setPrincipalAmount] = useState('');
  const [currency, setCurrency] = useState('NGN');
  const [interestRatePercent, setInterestRatePercent] = useState('');
  const [repaymentMethod, setRepaymentMethod] = useState<RepaymentMethod>('AMORTISING');
  const [repaymentFrequency, setRepaymentFrequency] = useState<RepaymentFrequency>('MONTHLY');
  const [startDate, setStartDate] = useState('');
  const [tenorMonths, setTenorMonths] = useState('');
  const [graceMonths, setGraceMonths] = useState('0');
  const [liabilityAccountId, setLiabilityAccountId] = useState('');
  const [interestExpenseAccountId, setInterestExpenseAccountId] = useState('');
  const [capitalRequirementId, setCapitalRequirementId] = useState('');
  const [notes, setNotes] = useState('');

  const { data: lendersData } = useQuery({
    queryKey: ['lenders', 'ACTIVE'],
    queryFn: () => listLenders({ status: 'ACTIVE' }),
  });
  const lenders = lendersData?.items ?? [];

  const { data: liabilityAccountsData } = useQuery({
    queryKey: ['chart-of-accounts', 'LIABILITY'],
    queryFn: () => listChartOfAccounts({ type: 'LIABILITY', isActive: true }),
  });
  const liabilityAccounts = (liabilityAccountsData?.items ?? []).filter(
    (account) => !account.isSystemAccount,
  );

  const { data: expenseAccountsData } = useQuery({
    queryKey: ['chart-of-accounts', 'EXPENSE'],
    queryFn: () => listChartOfAccounts({ type: 'EXPENSE', isActive: true }),
  });
  const expenseAccounts = (expenseAccountsData?.items ?? []).filter(
    (account) => !account.isSystemAccount,
  );

  const { data: requirementsData } = useQuery({
    queryKey: ['capital-requirements', 'APPROVED'],
    queryFn: () => listCapitalRequirements({ status: 'APPROVED' }),
  });
  const capitalRequirements = requirementsData?.items ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      createDebtFacility({
        lenderId,
        name,
        debtType,
        principalAmount: Number(principalAmount),
        currency,
        interestRatePercent: Number(interestRatePercent),
        repaymentMethod,
        repaymentFrequency,
        startDate,
        tenorMonths: Number(tenorMonths),
        graceMonths: Number(graceMonths) || 0,
        liabilityAccountId,
        interestExpenseAccountId,
        capitalRequirementId: capitalRequirementId || undefined,
        notes: notes || undefined,
        idempotencyKey,
      }),
    onSuccess: onCreated,
  });

  const canSubmit =
    !!lenderId &&
    name.trim().length > 0 &&
    Number(principalAmount) > 0 &&
    !!startDate &&
    Number(tenorMonths) > 0 &&
    !!liabilityAccountId &&
    !!interestExpenseAccountId;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Add Debt Facility</DialogTitle>
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
            placeholder="e.g. Bank Equipment Loan"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Lender</Label>
            <Select value={lenderId} onChange={(event) => setLenderId(event.target.value)}>
              <option value="">Select…</option>
              {lenders.map((lender) => (
                <option key={lender.id} value={lender.id}>
                  {lender.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Debt Type</Label>
            <Select
              value={debtType}
              onChange={(event) => setDebtType(event.target.value as DebtType)}
            >
              <option value="TERM_LOAN">Term Loan</option>
              <option value="WORKING_CAPITAL">Working Capital</option>
              <option value="ASSET_FINANCE">Asset Finance</option>
              <option value="OVERDRAFT">Overdraft</option>
              <option value="OTHER">Other</option>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Principal Amount</Label>
            <Input
              type="number"
              value={principalAmount}
              onChange={(event) => setPrincipalAmount(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Currency</Label>
            <Input value={currency} onChange={(event) => setCurrency(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Interest Rate % (annual)</Label>
            <Input
              type="number"
              value={interestRatePercent}
              onChange={(event) => setInterestRatePercent(event.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Repayment Method</Label>
            <Select
              value={repaymentMethod}
              onChange={(event) => setRepaymentMethod(event.target.value as RepaymentMethod)}
            >
              <option value="AMORTISING">Amortising</option>
              <option value="INTEREST_ONLY">Interest-Only</option>
              <option value="BULLET">Bullet</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Repayment Frequency</Label>
            <Select
              value={repaymentFrequency}
              onChange={(event) => setRepaymentFrequency(event.target.value as RepaymentFrequency)}
            >
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="YEARLY">Yearly</option>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Start Date</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Tenor (months)</Label>
            <Input
              type="number"
              value={tenorMonths}
              onChange={(event) => setTenorMonths(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Grace Period (months)</Label>
            <Input
              type="number"
              value={graceMonths}
              onChange={(event) => setGraceMonths(event.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Interest-only during grace — no principal due.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Liability Account</Label>
            <Select
              value={liabilityAccountId}
              onChange={(event) => setLiabilityAccountId(event.target.value)}
            >
              <option value="">Select…</option>
              {liabilityAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} {account.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Interest Expense Account</Label>
            <Select
              value={interestExpenseAccountId}
              onChange={(event) => setInterestExpenseAccountId(event.target.value)}
            >
              <option value="">Select…</option>
              {expenseAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} {account.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Capital Requirement (optional)</Label>
          <Select
            value={capitalRequirementId}
            onChange={(event) => setCapitalRequirementId(event.target.value)}
          >
            <option value="">None</option>
            {capitalRequirements.map((requirement) => (
              <option key={requirement.id} value={requirement.id}>
                {requirement.title}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            Links the facility back to the business need it finances — enough to understand why it
            exists, not a full allocation engine.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Notes (optional)</Label>
          <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to create debt facility.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Add Debt Facility'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
