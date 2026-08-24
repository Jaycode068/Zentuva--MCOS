import { AccountType, ChartOfAccount } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { ACCOUNTING_AUDIT_ACTIONS } from './accounting-audit-actions';
import { ChartOfAccountController } from './chart-of-account.controller';
import { ChartOfAccountService } from './chart-of-account.service';

describe('ChartOfAccountController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };
  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  const account: ChartOfAccount = {
    id: 'account-1',
    organisationId: 'org-1',
    code: '1200',
    name: 'Accounts Receivable',
    type: AccountType.ASSET,
    parentId: null,
    description: null,
    isActive: true,
    isSystemAccount: false,
    systemKey: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-24'),
    updatedAt: new Date('2026-08-24'),
  };

  function makeController() {
    const chartOfAccountService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      activate: jest.fn(),
      deactivate: jest.fn(),
    } as unknown as jest.Mocked<ChartOfAccountService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;

    const controller = new ChartOfAccountController(chartOfAccountService, auditService);
    return { controller, chartOfAccountService, auditService };
  }

  it('creates an account and records an audit entry', async () => {
    const { controller, chartOfAccountService, auditService } = makeController();
    chartOfAccountService.create.mockResolvedValue(account);

    const result = await controller.create(
      { code: '1200', name: 'Accounts Receivable', type: AccountType.ASSET },
      tokenUser,
      req,
    );

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: ACCOUNTING_AUDIT_ACTIONS.ACCOUNT_CREATED,
        entityId: 'account-1',
      }),
    );
    expect(result.code).toBe('1200');
  });

  it('updates an account and records an audit entry', async () => {
    const { controller, chartOfAccountService, auditService } = makeController();
    chartOfAccountService.update.mockResolvedValue({ ...account, name: 'Renamed' });

    await controller.update('account-1', { name: 'Renamed' }, tokenUser, req);

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: ACCOUNTING_AUDIT_ACTIONS.ACCOUNT_UPDATED }),
    );
  });

  it('activates and records an audit entry', async () => {
    const { controller, chartOfAccountService, auditService } = makeController();
    chartOfAccountService.activate.mockResolvedValue(account);

    await controller.activate('account-1', tokenUser, req);

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: ACCOUNTING_AUDIT_ACTIONS.ACCOUNT_ACTIVATED }),
    );
  });

  it('deactivates and records an audit entry', async () => {
    const { controller, chartOfAccountService, auditService } = makeController();
    chartOfAccountService.deactivate.mockResolvedValue({ ...account, isActive: false });

    await controller.deactivate('account-1', tokenUser, req);

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: ACCOUNTING_AUDIT_ACTIONS.ACCOUNT_DEACTIVATED }),
    );
  });

  it('lists accounts scoped to the caller organisation', async () => {
    const { controller, chartOfAccountService } = makeController();
    chartOfAccountService.list.mockResolvedValue([account]);

    const result = await controller.list(tokenUser);
    expect(chartOfAccountService.list).toHaveBeenCalledWith('org-1', expect.any(Object));
    expect(result.items).toHaveLength(1);
  });
});
