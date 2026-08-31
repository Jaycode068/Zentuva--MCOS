import { computeDebtBalance } from './debt-balance';

function makeClient(params: {
  drawdowns?: { amount: number }[];
  repayments?: { principalAmount: number; interestAmount: number }[];
  scheduleDueToDate?: { interestDue: number }[];
}) {
  return {
    debtDrawdown: {
      aggregate: jest.fn(async () => ({
        _sum: {
          amount: params.drawdowns?.length
            ? params.drawdowns.reduce((sum, row) => sum + row.amount, 0)
            : null,
        },
      })),
    },
    debtRepayment: {
      aggregate: jest.fn(async () => ({
        _sum: {
          principalAmount: params.repayments?.length
            ? params.repayments.reduce((sum, row) => sum + row.principalAmount, 0)
            : null,
          interestAmount: params.repayments?.length
            ? params.repayments.reduce((sum, row) => sum + row.interestAmount, 0)
            : null,
        },
      })),
    },
    debtRepaymentSchedule: {
      findMany: jest.fn(async () => params.scheduleDueToDate ?? []),
    },
  } as never;
}

describe('computeDebtBalance', () => {
  it('is zero across the board for a facility with no drawdowns yet', async () => {
    const balance = await computeDebtBalance(makeClient({}), 'facility-1');
    expect(balance).toEqual({
      totalDrawn: 0,
      outstandingPrincipal: 0,
      interestAccrued: 0,
      interestPaid: 0,
      outstandingInterest: 0,
      totalOutstanding: 0,
    });
  });

  it('outstandingPrincipal is drawn minus repaid, never original principal minus repaid (§13/§14)', async () => {
    const balance = await computeDebtBalance(
      makeClient({
        drawdowns: [{ amount: 60_000_000 }],
        repayments: [{ principalAmount: 20_000_000, interestAmount: 0 }],
      }),
      'facility-1',
    );
    expect(balance.totalDrawn).toBe(60_000_000);
    expect(balance.outstandingPrincipal).toBe(40_000_000);
  });

  it('outstandingInterest is accrued-to-date minus paid, floored at zero, never negative', async () => {
    const balance = await computeDebtBalance(
      makeClient({
        drawdowns: [{ amount: 60_000_000 }],
        repayments: [{ principalAmount: 0, interestAmount: 5_000_000 }],
        scheduleDueToDate: [{ interestDue: 1_000_000 }, { interestDue: 1_000_000 }],
      }),
      'facility-1',
    );
    expect(balance.interestAccrued).toBe(2_000_000);
    expect(balance.interestPaid).toBe(5_000_000);
    expect(balance.outstandingInterest).toBe(0);
  });

  it('totalOutstanding is the sum of outstanding principal and outstanding interest', async () => {
    const balance = await computeDebtBalance(
      makeClient({
        drawdowns: [{ amount: 60_000_000 }],
        repayments: [{ principalAmount: 20_000_000, interestAmount: 1_000_000 }],
        scheduleDueToDate: [{ interestDue: 1_000_000 }, { interestDue: 1_000_000 }],
      }),
      'facility-1',
    );
    expect(balance.outstandingPrincipal).toBe(40_000_000);
    expect(balance.outstandingInterest).toBe(1_000_000);
    expect(balance.totalOutstanding).toBe(41_000_000);
  });
});
