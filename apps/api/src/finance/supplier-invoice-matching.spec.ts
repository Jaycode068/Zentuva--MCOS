import { AccountType } from '@prisma/client';

import {
  computeHeaderMatchStatus,
  computeLineMatch,
  InvalidDebitAccountError,
  validatePathBAccount,
} from './supplier-invoice-matching';

describe('supplier-invoice-matching (Sprint 12 — the core of the sprint)', () => {
  describe('computeLineMatch — Path A capping formula', () => {
    it('Scenario A: an exact match against a fully-payable, untouched Goods Receipt line', () => {
      const result = computeLineMatch(
        {
          payableQuantity: 1000,
          returnedQuantity: 0,
          returnedExcessQuantity: 0,
          invoicedQuantity: 0,
        },
        1000,
        { quantity: 1000, lineTotal: 1_000_000 },
      );
      expect(result).toEqual({
        recognizedAmount: 1_000_000,
        varianceAmount: 0,
        invoicedQuantityDelta: 1000,
      });
    });

    it('Scenario C: an over-invoice is capped exactly at the remaining payable value, never inflated', () => {
      // Sprint 8 excess-supply worked example: accepted 1050, payable 1000 -> 50
      // excess sits in GRNI, never in the payable pool. Invoicing 1050 must still
      // recognize only 1,000,000.
      const result = computeLineMatch(
        {
          payableQuantity: 1000,
          returnedQuantity: 0,
          returnedExcessQuantity: 0,
          invoicedQuantity: 0,
        },
        1000,
        { quantity: 1050, lineTotal: 1_050_000 },
      );
      expect(result.recognizedAmount).toBe(1_000_000);
      expect(result.varianceAmount).toBe(50_000);
      expect(result.invoicedQuantityDelta).toBe(1000);
    });

    it('Scenario B: an invoice that matches exactly the payable quantity leaves the GRNI excess untouched (no over-recognition)', () => {
      const result = computeLineMatch(
        {
          payableQuantity: 1000,
          returnedQuantity: 0,
          returnedExcessQuantity: 0,
          invoicedQuantity: 0,
        },
        1000,
        { quantity: 1000, lineTotal: 1_000_000 },
      );
      expect(result.recognizedAmount).toBe(1_000_000);
      expect(result.varianceAmount).toBe(0);
    });

    it('Scenario D: a partial invoice (600 of 1000) fully matches, leaving 400 remaining for a later invoice', () => {
      const first = computeLineMatch(
        {
          payableQuantity: 1000,
          returnedQuantity: 0,
          returnedExcessQuantity: 0,
          invoicedQuantity: 0,
        },
        1000,
        { quantity: 600, lineTotal: 600_000 },
      );
      expect(first.recognizedAmount).toBe(600_000);
      expect(first.varianceAmount).toBe(0);
      expect(first.invoicedQuantityDelta).toBe(600);

      // A second invoice, after the first posted and incremented invoicedQuantity to 600.
      const second = computeLineMatch(
        {
          payableQuantity: 1000,
          returnedQuantity: 0,
          returnedExcessQuantity: 0,
          invoicedQuantity: 600,
        },
        1000,
        { quantity: 400, lineTotal: 400_000 },
      );
      expect(second.recognizedAmount).toBe(400_000);
      expect(second.varianceAmount).toBe(0);
      expect(second.invoicedQuantityDelta).toBe(400);
    });

    it('a third invoice claiming more than what remains after two prior invoices is capped at zero remaining', () => {
      const result = computeLineMatch(
        {
          payableQuantity: 1000,
          returnedQuantity: 0,
          returnedExcessQuantity: 0,
          invoicedQuantity: 1000,
        },
        1000,
        { quantity: 100, lineTotal: 100_000 },
      );
      expect(result.recognizedAmount).toBe(0);
      expect(result.varianceAmount).toBe(100_000);
      expect(result.invoicedQuantityDelta).toBe(0);
    });

    it('a Sprint 11 Supplier Return against the payable bucket reduces the remaining payable pool', () => {
      // 1000 payable, 100 returned entirely from the payable bucket (excessPortion 0)
      // -> only 900 remains invoiceable.
      const result = computeLineMatch(
        {
          payableQuantity: 1000,
          returnedQuantity: 100,
          returnedExcessQuantity: 0,
          invoicedQuantity: 0,
        },
        1000,
        { quantity: 1000, lineTotal: 1_000_000 },
      );
      expect(result.recognizedAmount).toBe(900_000);
      expect(result.varianceAmount).toBe(100_000);
    });

    it('a Sprint 11 Supplier Return against the excess bucket does not reduce the payable pool', () => {
      // 1000 payable, 50 excess returned (returnedExcessQuantity === returnedQuantity)
      // -> the payable bucket itself is untouched, still fully invoiceable at 1000.
      const result = computeLineMatch(
        {
          payableQuantity: 1000,
          returnedQuantity: 50,
          returnedExcessQuantity: 50,
          invoicedQuantity: 0,
        },
        1000,
        { quantity: 1000, lineTotal: 1_000_000 },
      );
      expect(result.recognizedAmount).toBe(1_000_000);
      expect(result.varianceAmount).toBe(0);
    });

    it('a price mismatch is captured by the same unified cap, even at a matching quantity', () => {
      // Invoice bills the same 1000 units but at ₦1,100 instead of the PO's frozen
      // ₦1,000 — the cap uses the PO's own price, so only 1,000,000 recognizes.
      const result = computeLineMatch(
        {
          payableQuantity: 1000,
          returnedQuantity: 0,
          returnedExcessQuantity: 0,
          invoicedQuantity: 0,
        },
        1000,
        { quantity: 1000, lineTotal: 1_100_000 },
      );
      expect(result.recognizedAmount).toBe(1_000_000);
      expect(result.varianceAmount).toBe(100_000);
    });
  });

  describe('computeHeaderMatchStatus', () => {
    it('is UNVERIFIED when the invoice has zero Path A lines', () => {
      expect(computeHeaderMatchStatus([])).toBe('UNVERIFIED');
    });

    it('is MATCHED when every Path A line has zero variance', () => {
      expect(computeHeaderMatchStatus([0, 0])).toBe('MATCHED');
    });

    it('is DISCREPANCY when any Path A line has a positive variance', () => {
      expect(computeHeaderMatchStatus([0, 50_000])).toBe('DISCREPANCY');
    });
  });

  describe('validatePathBAccount', () => {
    it('accepts a non-system Expense account', () => {
      expect(() =>
        validatePathBAccount({ type: AccountType.EXPENSE, isSystemAccount: false }),
      ).not.toThrow();
    });

    it('accepts a non-system Asset account', () => {
      expect(() =>
        validatePathBAccount({ type: AccountType.ASSET, isSystemAccount: false }),
      ).not.toThrow();
    });

    it('rejects a missing account', () => {
      expect(() => validatePathBAccount(null)).toThrow(InvalidDebitAccountError);
    });

    it('rejects a system account even if the type would otherwise be allowed', () => {
      expect(() =>
        validatePathBAccount({ type: AccountType.EXPENSE, isSystemAccount: true }),
      ).toThrow(InvalidDebitAccountError);
    });

    it.each([
      AccountType.LIABILITY,
      AccountType.EQUITY,
      AccountType.REVENUE,
      AccountType.COST_OF_SALES,
    ])('rejects a %s account', (type) => {
      expect(() => validatePathBAccount({ type, isSystemAccount: false })).toThrow(
        InvalidDebitAccountError,
      );
    });
  });
});
