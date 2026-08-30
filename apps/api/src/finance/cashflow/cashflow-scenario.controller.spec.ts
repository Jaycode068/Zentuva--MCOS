import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CashflowScenarioController } from './cashflow-scenario.controller';
import { CashflowScenarioService } from './cashflow-scenario.service';

function makeUser(organisationId: string): TokenPayload {
  return { sub: 'user-1', organisationId, sessionId: 'session-1' };
}

const SCENARIO = {
  id: 'scn-1',
  organisationId: 'org-1',
  name: 'Conservative',
  description: null,
  inflowDelayDays: 30,
  inflowMultiplier: 0.8,
  outflowDelayDays: 0,
  outflowMultiplier: 1,
  status: 'ACTIVE' as const,
  idempotencyKey: null,
  createdById: 'user-1',
  updatedById: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('CashflowScenarioController', () => {
  function makeController() {
    const cashflowScenarioService = {
      list: jest.fn().mockResolvedValue([SCENARIO]),
      getById: jest.fn().mockResolvedValue(SCENARIO),
      create: jest.fn().mockResolvedValue({ cashflowScenario: SCENARIO, wasCreated: true }),
      update: jest.fn().mockResolvedValue(SCENARIO),
      deactivate: jest.fn().mockResolvedValue({ ...SCENARIO, status: 'INACTIVE' }),
    } as unknown as jest.Mocked<CashflowScenarioService>;
    const auditService = { record: jest.fn() };
    return {
      controller: new CashflowScenarioController(cashflowScenarioService, auditService as never),
      cashflowScenarioService,
      auditService,
    };
  }

  it('tenant isolation: every route is scoped by the caller organisation', async () => {
    const { controller, cashflowScenarioService } = makeController();
    await controller.list(makeUser('org-2'));
    await controller.getOne(makeUser('org-2'), 'scn-1');

    expect(cashflowScenarioService.list).toHaveBeenCalledWith('org-2', expect.anything());
    expect(cashflowScenarioService.getById).toHaveBeenCalledWith('org-2', 'scn-1');
  });

  it('only emits the audit event when the service reports wasCreated: true', async () => {
    const { controller, cashflowScenarioService, auditService } = makeController();
    cashflowScenarioService.create.mockResolvedValueOnce({
      cashflowScenario: SCENARIO,
      wasCreated: false,
    });

    await controller.create(
      {
        name: 'Conservative',
        inflowDelayDays: 30,
        inflowMultiplier: 0.8,
        outflowDelayDays: 0,
        outflowMultiplier: 1,
      },
      makeUser('org-1'),
      { ip: '', headers: {} } as never,
    );

    expect(auditService.record).not.toHaveBeenCalled();
  });
});
