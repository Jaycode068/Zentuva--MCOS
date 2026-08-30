import { CostCentreStatus } from '@prisma/client';

import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CostCentreController } from './cost-centre.controller';
import { CostCentreService } from './cost-centre.service';

function makeUser(organisationId: string): TokenPayload {
  return { sub: 'user-1', organisationId, sessionId: 'session-1' };
}

const COST_CENTRE = {
  id: 'cc-1',
  organisationId: 'org-1',
  code: 'PROD',
  name: 'Production',
  description: null,
  status: CostCentreStatus.ACTIVE,
  createdById: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('CostCentreController', () => {
  function makeController() {
    const costCentreService = {
      list: jest.fn().mockResolvedValue([COST_CENTRE]),
      getById: jest.fn().mockResolvedValue(COST_CENTRE),
      create: jest.fn().mockResolvedValue({ costCentre: COST_CENTRE, wasCreated: true }),
      update: jest.fn().mockResolvedValue(COST_CENTRE),
      deactivate: jest
        .fn()
        .mockResolvedValue({ ...COST_CENTRE, status: CostCentreStatus.INACTIVE }),
      activate: jest.fn().mockResolvedValue(COST_CENTRE),
    } as unknown as jest.Mocked<CostCentreService>;
    const auditService = { record: jest.fn() };
    return {
      controller: new CostCentreController(costCentreService, auditService as never),
      costCentreService,
      auditService,
    };
  }

  it('tenant isolation: list/get are scoped by the caller organisation', async () => {
    const { controller, costCentreService } = makeController();
    await controller.list(makeUser('org-2'));
    await controller.getOne(makeUser('org-2'), 'cc-1');
    expect(costCentreService.list).toHaveBeenCalledWith('org-2', expect.anything());
    expect(costCentreService.getById).toHaveBeenCalledWith('org-2', 'cc-1');
  });

  it('only emits cost-centre.created when the service reports wasCreated: true', async () => {
    const { controller, costCentreService, auditService } = makeController();
    await controller.create({ code: 'PROD' } as never, makeUser('org-1'), {
      ip: '1.1.1.1',
      headers: {},
    } as never);
    expect(auditService.record).toHaveBeenCalledTimes(1);

    (costCentreService.create as jest.Mock).mockResolvedValueOnce({
      costCentre: COST_CENTRE,
      wasCreated: false,
    });
    auditService.record.mockClear();
    await controller.create({ code: 'PROD' } as never, makeUser('org-1'), {
      ip: '1.1.1.1',
      headers: {},
    } as never);
    expect(auditService.record).not.toHaveBeenCalled();
  });
});
