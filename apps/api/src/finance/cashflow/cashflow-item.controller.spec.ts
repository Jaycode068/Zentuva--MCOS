import { CashflowDirection, CashflowForecastSourceType, CashflowRecurrence } from '@prisma/client';

import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CashflowItemController } from './cashflow-item.controller';
import { CashflowItemService } from './cashflow-item.service';

function makeUser(organisationId: string): TokenPayload {
  return { sub: 'user-1', organisationId, sessionId: 'session-1' };
}

const ITEM = {
  id: 'item-1',
  organisationId: 'org-1',
  cashAccountId: null,
  direction: CashflowDirection.OUTFLOW,
  sourceType: CashflowForecastSourceType.RECURRING_ITEM,
  description: 'Factory Rent',
  amount: 1_500_000,
  currency: 'NGN',
  expectedDate: new Date(),
  recurrence: CashflowRecurrence.MONTHLY,
  recurrenceEndDate: null,
  status: 'ACTIVE' as const,
  notes: null,
  idempotencyKey: null,
  createdById: 'user-1',
  updatedById: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('CashflowItemController', () => {
  function makeController() {
    const cashflowItemService = {
      list: jest.fn().mockResolvedValue([ITEM]),
      getById: jest.fn().mockResolvedValue(ITEM),
      create: jest.fn().mockResolvedValue({ cashflowForecastItem: ITEM, wasCreated: true }),
      update: jest.fn().mockResolvedValue(ITEM),
      deactivate: jest.fn().mockResolvedValue({ ...ITEM, status: 'INACTIVE' }),
      activate: jest.fn().mockResolvedValue(ITEM),
    } as unknown as jest.Mocked<CashflowItemService>;
    const auditService = { record: jest.fn() };
    return {
      controller: new CashflowItemController(cashflowItemService, auditService as never),
      cashflowItemService,
      auditService,
    };
  }

  it('tenant isolation: every route is scoped by the caller organisation', async () => {
    const { controller, cashflowItemService } = makeController();
    await controller.list(makeUser('org-2'));
    await controller.getOne(makeUser('org-2'), 'item-1');

    expect(cashflowItemService.list).toHaveBeenCalledWith('org-2', expect.anything());
    expect(cashflowItemService.getById).toHaveBeenCalledWith('org-2', 'item-1');
  });

  it('only emits the audit event when the service reports wasCreated: true', async () => {
    const { controller, cashflowItemService, auditService } = makeController();
    cashflowItemService.create.mockResolvedValueOnce({
      cashflowForecastItem: ITEM,
      wasCreated: false,
    });

    await controller.create(
      {
        direction: CashflowDirection.OUTFLOW,
        description: 'Rent',
        amount: 1_500_000,
        currency: 'NGN',
        expectedDate: new Date(),
        recurrence: CashflowRecurrence.MONTHLY,
      },
      makeUser('org-1'),
      { ip: '', headers: {} } as never,
    );

    expect(auditService.record).not.toHaveBeenCalled();
  });
});
