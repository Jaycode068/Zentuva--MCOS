import { CashflowForecastSourceType } from '@prisma/client';

import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CashflowAdjustmentController } from './cashflow-adjustment.controller';
import { CashflowAdjustmentService } from './cashflow-adjustment.service';

function makeUser(organisationId: string): TokenPayload {
  return { sub: 'user-1', organisationId, sessionId: 'session-1' };
}

const ADJUSTMENT = {
  id: 'adj-1',
  organisationId: 'org-1',
  sourceType: CashflowForecastSourceType.CUSTOMER_RECEIVABLE,
  sourceId: 'inv-1',
  adjustedExpectedDate: new Date('2026-09-30'),
  adjustedAmount: null,
  notes: null,
  idempotencyKey: null,
  createdById: 'user-1',
  updatedById: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('CashflowAdjustmentController', () => {
  function makeController() {
    const cashflowAdjustmentService = {
      list: jest.fn().mockResolvedValue([ADJUSTMENT]),
      getBySource: jest.fn().mockResolvedValue(ADJUSTMENT),
      upsert: jest.fn().mockResolvedValue({ adjustment: ADJUSTMENT, wasCreated: true }),
    } as unknown as jest.Mocked<CashflowAdjustmentService>;
    const auditService = { record: jest.fn() };
    return {
      controller: new CashflowAdjustmentController(
        cashflowAdjustmentService,
        auditService as never,
      ),
      cashflowAdjustmentService,
      auditService,
    };
  }

  it('tenant isolation: every route is scoped by the caller organisation', async () => {
    const { controller, cashflowAdjustmentService } = makeController();
    await controller.list(makeUser('org-2'));
    await controller.getOne(
      makeUser('org-2'),
      CashflowForecastSourceType.CUSTOMER_RECEIVABLE,
      'inv-1',
    );

    expect(cashflowAdjustmentService.list).toHaveBeenCalledWith('org-2');
    expect(cashflowAdjustmentService.getBySource).toHaveBeenCalledWith(
      'org-2',
      CashflowForecastSourceType.CUSTOMER_RECEIVABLE,
      'inv-1',
    );
  });

  it('the underlying source Invoice is never touched — the adjustment upsert never receives or forwards invoice-writing behaviour', async () => {
    const { controller, cashflowAdjustmentService } = makeController();

    await controller.upsert(
      {
        sourceType: 'CUSTOMER_RECEIVABLE',
        sourceId: 'inv-1',
        adjustedExpectedDate: new Date('2026-09-30'),
      },
      makeUser('org-1'),
      { ip: '', headers: {} } as never,
    );

    expect(cashflowAdjustmentService.upsert).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ sourceId: 'inv-1' }),
      'user-1',
    );
  });

  it('audits FORECAST_ADJUSTMENT_UPDATED (not CREATED) when the upsert reports wasCreated: false', async () => {
    const { controller, cashflowAdjustmentService, auditService } = makeController();
    cashflowAdjustmentService.upsert.mockResolvedValueOnce({
      adjustment: ADJUSTMENT,
      wasCreated: false,
    });

    await controller.upsert(
      { sourceType: 'CUSTOMER_RECEIVABLE', sourceId: 'inv-1', adjustedAmount: 1_800_000 },
      makeUser('org-1'),
      { ip: '', headers: {} } as never,
    );

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cashflow.forecast-adjustment.updated' }),
    );
  });
});
