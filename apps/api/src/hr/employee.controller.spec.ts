import { TokenPayload } from '../identity/auth/ports/token.port';
import { EffectiveAccessResolver } from '../identity/authorization/effective-access-resolver';
import { ScopeEvaluator } from '../identity/authorization/scope-evaluator';
import { AttendanceService } from './attendance.service';
import { EmployeeController } from './employee.controller';
import { EmployeeDocumentService } from './employee-document.service';
import { EmployeeOnboardingService } from './employee-onboarding.service';
import { EmployeeTrainingService } from './employee-training.service';
import { EmployeeService } from './employee.service';
import { PolicyService } from './policy.service';

/** Sprint 25.1 (docs/architecture/authorization-coverage.md) — `hr.employee.view`'s
 *  real, server-enforced scope (introduced Sprint 25, never previously unit-tested at
 *  the controller level — only live-verified). */
describe('EmployeeController.list scope enforcement', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };
  const callerEmployee = { id: 'employee-1', departmentId: 'dept-1' };

  function makeController(grantedScopes: string[]) {
    const employeeService = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getByUserId: jest.fn().mockResolvedValue(callerEmployee),
    } as unknown as jest.Mocked<EmployeeService>;
    const onboardingService = {} as unknown as jest.Mocked<EmployeeOnboardingService>;
    const documentService = {} as unknown as jest.Mocked<EmployeeDocumentService>;
    const attendanceService = {} as unknown as jest.Mocked<AttendanceService>;
    const policyService = {} as unknown as jest.Mocked<PolicyService>;
    const employeeTrainingService = {} as unknown as jest.Mocked<EmployeeTrainingService>;
    const auditService = { record: jest.fn() } as never;
    const effectiveAccessResolver = {
      resolve: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<EffectiveAccessResolver>;
    const scopeEvaluator = {
      grantedScopes: jest.fn().mockReturnValue(grantedScopes),
    } as unknown as jest.Mocked<ScopeEvaluator>;

    const controller = new EmployeeController(
      employeeService,
      onboardingService,
      documentService,
      attendanceService,
      policyService,
      employeeTrainingService,
      auditService,
      effectiveAccessResolver,
      scopeEvaluator,
    );
    return { controller, employeeService };
  }

  it('applies no scope filter when granted ORGANISATION', async () => {
    const { controller, employeeService } = makeController(['ORGANISATION']);

    await controller.list(tokenUser);

    expect(employeeService.list).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ departmentId: undefined, managerEmployeeId: undefined }),
    );
  });

  it("forces the filter to the caller's own department when granted only DEPARTMENT", async () => {
    const { controller, employeeService } = makeController(['DEPARTMENT']);

    await controller.list(tokenUser);

    expect(employeeService.list).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ departmentId: 'dept-1', managerEmployeeId: undefined }),
    );
  });

  it("forces the filter to the caller's own direct reports when granted only OWN_TEAM", async () => {
    const { controller, employeeService } = makeController(['OWN_TEAM']);

    await controller.list(tokenUser);

    expect(employeeService.list).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ managerEmployeeId: 'employee-1' }),
    );
  });

  it('returns an empty page — never unrestricted access — when no usable scope is granted', async () => {
    const { controller, employeeService } = makeController([]);

    const result = await controller.list(tokenUser);

    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
    expect(employeeService.list).not.toHaveBeenCalled();
  });
});
