import { BudgetStatus } from '@prisma/client';

import { TokenPayload } from '../../identity/auth/ports/token.port';
import { BudgetController } from './budget.controller';
import { BudgetService } from './budget.service';
import { BudgetLineService } from './budget-line.service';
import { BudgetActualsService } from './budget-actuals.service';
import { BudgetForecastService } from './budget-forecast.service';

function makeUser(organisationId: string): TokenPayload {
  return { sub: 'user-1', organisationId, sessionId: 'session-1' };
}

const BUDGET = {
  id: 'budget-1',
  organisationId: 'org-1',
  budgetCode: 'BUD-2026-OPS',
  name: '2026 Operating Budget',
  description: null,
  fiscalYear: 2026,
  scenarioName: 'Base',
  version: 1,
  revisesBudgetId: null,
  cashflowScenarioId: null,
  startDate: new Date(2026, 0, 1),
  endDate: new Date(2026, 11, 31),
  currency: 'NGN',
  status: BudgetStatus.DRAFT,
  notes: null,
  idempotencyKey: null,
  createdById: 'user-1',
  approvedById: null,
  approvedAt: null,
  activatedAt: null,
  closedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('BudgetController', () => {
  function makeController() {
    const budgetService = {
      list: jest.fn().mockResolvedValue([BUDGET]),
      getById: jest.fn().mockResolvedValue(BUDGET),
      listSiblings: jest.fn().mockResolvedValue([BUDGET]),
      create: jest.fn().mockResolvedValue({ budget: BUDGET, wasCreated: true }),
      update: jest.fn().mockResolvedValue(BUDGET),
      approve: jest.fn().mockResolvedValue({ ...BUDGET, status: BudgetStatus.APPROVED }),
      activate: jest.fn().mockResolvedValue({ ...BUDGET, status: BudgetStatus.ACTIVE }),
      close: jest.fn().mockResolvedValue({ ...BUDGET, status: BudgetStatus.CLOSED }),
      revise: jest.fn().mockResolvedValue({ ...BUDGET, id: 'budget-2', version: 2 }),
    } as unknown as jest.Mocked<BudgetService>;
    const budgetLineService = {
      list: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<BudgetLineService>;
    const budgetActualsService = {
      getVarianceReport: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<BudgetActualsService>;
    const budgetForecastService = {
      getBudgetVsForecast: jest.fn().mockResolvedValue({ applicable: true, periods: [] }),
    } as unknown as jest.Mocked<BudgetForecastService>;
    const auditService = { record: jest.fn() };

    return {
      controller: new BudgetController(
        budgetService,
        budgetLineService,
        budgetActualsService,
        budgetForecastService,
        auditService as never,
      ),
      budgetService,
      budgetActualsService,
      budgetForecastService,
      auditService,
    };
  }

  it('tenant isolation: list/get/vs-actual/vs-forecast are all scoped by the caller organisation', async () => {
    const { controller, budgetService, budgetActualsService, budgetForecastService } =
      makeController();
    await controller.list(makeUser('org-2'));
    await controller.getOne(makeUser('org-2'), 'budget-1');
    await controller.vsActual(makeUser('org-2'), 'budget-1');
    await controller.vsForecast(makeUser('org-2'), 'budget-1');

    expect(budgetService.list).toHaveBeenCalledWith('org-2', expect.anything());
    expect(budgetService.getById).toHaveBeenCalledWith('org-2', 'budget-1');
    expect(budgetActualsService.getVarianceReport).toHaveBeenCalledWith('org-2', 'budget-1');
    expect(budgetForecastService.getBudgetVsForecast).toHaveBeenCalledWith('org-2', 'budget-1');
  });

  it('only emits budget.created when the service reports wasCreated: true', async () => {
    const { controller, budgetService, auditService } = makeController();

    await controller.create({ budgetCode: 'BUD-2026-OPS' } as never, makeUser('org-1'), {
      ip: '1.1.1.1',
      headers: {},
    } as never);
    expect(auditService.record).toHaveBeenCalledTimes(1);
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'budget.created' }),
    );

    (budgetService.create as jest.Mock).mockResolvedValueOnce({
      budget: BUDGET,
      wasCreated: false,
    });
    auditService.record.mockClear();
    await controller.create({ budgetCode: 'BUD-2026-OPS' } as never, makeUser('org-1'), {
      ip: '1.1.1.1',
      headers: {},
    } as never);
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('emits budget.activated on activate', async () => {
    const { controller, auditService } = makeController();
    await controller.activate('budget-1', makeUser('org-1'), {
      ip: '1.1.1.1',
      headers: {},
    } as never);
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'budget.activated' }),
    );
  });

  it('emits budget.revised with the source budget id in metadata', async () => {
    const { controller, auditService } = makeController();
    await controller.revise('budget-1', makeUser('org-1'), { ip: '1.1.1.1', headers: {} } as never);
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'budget.revised',
        metadata: expect.objectContaining({ revisesBudgetId: 'budget-1' }),
      }),
    );
  });
});
