import { TokenPayload } from '../identity/auth/ports/token.port';
import { EffectiveAccessResolver } from '../identity/authorization/effective-access-resolver';
import { ScopeEvaluator } from '../identity/authorization/scope-evaluator';
import { AttendanceCorrectionService } from './attendance-correction.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { EmployeeService } from './employee.service';

/** Sprint 25.1 (docs/architecture/authorization-coverage.md) — `hr.attendance.view`'s
 *  real, server-enforced scope, the exact `EmployeeController.list()` pattern Sprint 25
 *  established for `hr.employee.view`, extended here to attendance. */
describe('AttendanceController.list scope enforcement', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };
  const callerEmployee = { id: 'employee-1', departmentId: 'dept-1' };

  function makeController(grantedScopes: string[]) {
    const attendanceService = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    } as unknown as jest.Mocked<AttendanceService>;
    const correctionService = {} as unknown as jest.Mocked<AttendanceCorrectionService>;
    const auditService = { record: jest.fn() } as never;
    const employeeService = {
      getByUserId: jest.fn().mockResolvedValue(callerEmployee),
    } as unknown as jest.Mocked<EmployeeService>;
    const effectiveAccessResolver = {
      resolve: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<EffectiveAccessResolver>;
    const scopeEvaluator = {
      grantedScopes: jest.fn().mockReturnValue(grantedScopes),
    } as unknown as jest.Mocked<ScopeEvaluator>;

    const controller = new AttendanceController(
      attendanceService,
      correctionService,
      auditService,
      employeeService,
      effectiveAccessResolver,
      scopeEvaluator,
    );
    return { controller, attendanceService };
  }

  it('applies no scope filter when granted ORGANISATION', async () => {
    const { controller, attendanceService } = makeController(['ORGANISATION']);

    await controller.list(tokenUser);

    expect(attendanceService.list).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ departmentId: undefined, managerEmployeeId: undefined }),
    );
  });

  it("forces the filter to the caller's own department when granted only DEPARTMENT", async () => {
    const { controller, attendanceService } = makeController(['DEPARTMENT']);

    await controller.list(tokenUser);

    expect(attendanceService.list).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ departmentId: 'dept-1', managerEmployeeId: undefined }),
    );
  });

  it("forces the filter to the caller's own direct reports when granted only OWN_TEAM", async () => {
    const { controller, attendanceService } = makeController(['OWN_TEAM']);

    await controller.list(tokenUser);

    expect(attendanceService.list).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ managerEmployeeId: 'employee-1' }),
    );
  });

  it('returns an empty page — never unrestricted access — when no usable scope is granted', async () => {
    const { controller, attendanceService } = makeController([]);

    const result = await controller.list(tokenUser);

    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
    expect(attendanceService.list).not.toHaveBeenCalled();
  });
});
