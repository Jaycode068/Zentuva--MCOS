import { BadRequestException, NotFoundException } from '@nestjs/common';

import { EmployeeService } from './employee.service';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

function makeEmployee(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'emp-1',
    organisationId: ORG,
    employeeCode: 'EMP-000001',
    userId: null,
    firstName: 'Ada',
    lastName: 'Okoro',
    managerEmployeeId: null,
    employmentStatus: 'ACTIVE',
    employmentType: 'FULL_TIME',
    ...overrides,
  };
}

function makeService(options?: {
  employees?: Record<string, Record<string, unknown>>;
  users?: Record<string, Record<string, unknown>>;
}) {
  const employees: Record<string, Record<string, unknown>> = options?.employees ?? {
    'emp-1': makeEmployee(),
  };
  const users: Record<string, Record<string, unknown>> = options?.users ?? {
    'user-1': { id: 'user-1', organisationId: ORG },
  };

  const employeeRepository = {
    findById: jest.fn(async (org: string, id: string) => {
      const e = employees[id];
      return e && e.organisationId === org ? e : null;
    }),
    findByUserId: jest.fn(async (org: string, userId: string) => {
      return (
        Object.values(employees).find((e) => e.organisationId === org && e.userId === userId) ??
        null
      );
    }),
    getManagerId: jest.fn(async (id: string) => employees[id]?.managerEmployeeId ?? null),
    create: jest.fn(async (data: Record<string, unknown>) => ({
      ...makeEmployee(),
      ...data,
      id: 'emp-new',
      employeeCode: 'EMP-000002',
      employmentStatus: 'DRAFT',
    })),
    update: jest.fn(async (org: string, id: string, data: Record<string, unknown>) => {
      const e = employees[id];
      if (!e || e.organisationId !== org) return null;
      employees[id] = { ...e, ...data };
      return employees[id];
    }),
    assignDepartment: jest.fn(async (org: string, id: string, departmentId: string | null) => {
      const e = employees[id];
      if (!e || e.organisationId !== org) return null;
      employees[id] = { ...e, departmentId };
      return employees[id];
    }),
    assignPosition: jest.fn(async (org: string, id: string, positionId: string | null) => {
      const e = employees[id];
      if (!e || e.organisationId !== org) return null;
      employees[id] = { ...e, positionId };
      return employees[id];
    }),
    assignManager: jest.fn(async (org: string, id: string, managerEmployeeId: string | null) => {
      const e = employees[id];
      if (!e || e.organisationId !== org) return null;
      employees[id] = { ...e, managerEmployeeId };
      return employees[id];
    }),
    linkUser: jest.fn(async (org: string, id: string, userId: string) => {
      const e = employees[id];
      if (!e || e.organisationId !== org) return { employee: null, conflict: false };
      employees[id] = { ...e, userId };
      return { employee: employees[id], conflict: false };
    }),
    unlinkUser: jest.fn(async (org: string, id: string) => {
      const e = employees[id];
      if (!e || e.organisationId !== org) return null;
      employees[id] = { ...e, userId: null };
      return employees[id];
    }),
    setEmploymentStatus: jest.fn(async (org: string, id: string, data: Record<string, unknown>) => {
      const e = employees[id];
      if (!e || e.organisationId !== org) return null;
      employees[id] = { ...e, ...data };
      return employees[id];
    }),
  };

  const departmentRepository = { findById: jest.fn(async () => ({ id: 'dept-1' })) };
  const positionRepository = { findById: jest.fn(async () => ({ id: 'pos-1' })) };
  const workScheduleRepository = { findById: jest.fn(async () => ({ id: 'schedule-1' })) };
  const userService = {
    getById: jest.fn(async (org: string, id: string) => {
      const u = users[id];
      return u && u.organisationId === org ? u : null;
    }),
  };

  const service = new EmployeeService(
    employeeRepository as never,
    departmentRepository as never,
    positionRepository as never,
    workScheduleRepository as never,
    userService as never,
  );
  return { service, employeeRepository, userService };
}

describe('EmployeeService — lifecycle transitions', () => {
  it('activate(): DRAFT -> ACTIVE', async () => {
    const { service } = makeService({
      employees: { 'emp-1': makeEmployee({ employmentStatus: 'DRAFT' }) },
    });
    const { employee, transitioned } = await service.activate(ORG, 'emp-1');
    expect(transitioned).toBe(true);
    expect(employee.employmentStatus).toBe('ACTIVE');
  });

  it('activate(): is soft-idempotent when already ACTIVE', async () => {
    const { service } = makeService();
    const { transitioned } = await service.activate(ORG, 'emp-1');
    expect(transitioned).toBe(false);
  });

  it('suspend(): ACTIVE -> SUSPENDED', async () => {
    const { service } = makeService();
    const { employee, transitioned } = await service.suspend(ORG, 'emp-1');
    expect(transitioned).toBe(true);
    expect(employee.employmentStatus).toBe('SUSPENDED');
  });

  it('suspend(): rejects suspending a DRAFT employee (invalid transition)', async () => {
    const { service } = makeService({
      employees: { 'emp-1': makeEmployee({ employmentStatus: 'DRAFT' }) },
    });
    await expect(service.suspend(ORG, 'emp-1')).rejects.toThrow(BadRequestException);
  });

  it('reactivate(): SUSPENDED -> ACTIVE', async () => {
    const { service } = makeService({
      employees: { 'emp-1': makeEmployee({ employmentStatus: 'SUSPENDED' }) },
    });
    const { employee, transitioned } = await service.reactivate(ORG, 'emp-1');
    expect(transitioned).toBe(true);
    expect(employee.employmentStatus).toBe('ACTIVE');
  });

  it("reactivate(): rejects reactivating an ACTIVE employee's non-suspended state (invalid transition path guarded)", async () => {
    const { service } = makeService({
      employees: { 'emp-1': makeEmployee({ employmentStatus: 'DRAFT' }) },
    });
    await expect(service.reactivate(ORG, 'emp-1')).rejects.toThrow(BadRequestException);
  });

  it('separate(): ACTIVE -> SEPARATED, recording date and reason', async () => {
    const { service } = makeService();
    const separationDate = new Date('2026-09-01');
    const { employee, transitioned } = await service.separate(ORG, 'emp-1', {
      separationDate,
      separationReason: 'Resignation',
    });
    expect(transitioned).toBe(true);
    expect(employee.employmentStatus).toBe('SEPARATED');
    expect(employee.separationDate).toBe(separationDate);
    expect(employee.separationReason).toBe('Resignation');
  });

  it('separate(): is hard-terminal — a second lifecycle action on a separated employee is rejected', async () => {
    const { service } = makeService({
      employees: { 'emp-1': makeEmployee({ employmentStatus: 'SEPARATED' }) },
    });
    await expect(service.activate(ORG, 'emp-1')).rejects.toThrow(BadRequestException);
    await expect(service.suspend(ORG, 'emp-1')).rejects.toThrow(BadRequestException);
    await expect(service.separate(ORG, 'emp-1', { separationDate: new Date() })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('separation history is retained — the employee record still exists and is readable after separation', async () => {
    const { service } = makeService({
      employees: { 'emp-1': makeEmployee({ employmentStatus: 'ACTIVE' }) },
    });
    await service.separate(ORG, 'emp-1', { separationDate: new Date() });
    const employee = await service.getById(ORG, 'emp-1');
    expect(employee.employmentStatus).toBe('SEPARATED');
  });
});

describe('EmployeeService — reporting-line validation', () => {
  it('rejects an employee reporting to themselves', async () => {
    const { service } = makeService();
    await expect(service.assignManager(ORG, 'emp-1', 'emp-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects a manager from a different organisation', async () => {
    const employees = {
      'emp-1': makeEmployee({ id: 'emp-1' }),
      'emp-2': makeEmployee({ id: 'emp-2', organisationId: OTHER_ORG }),
    };
    const { service } = makeService({ employees });
    await expect(service.assignManager(ORG, 'emp-1', 'emp-2')).rejects.toThrow(BadRequestException);
  });

  it('rejects a circular reporting relationship', async () => {
    const employees = {
      'emp-1': makeEmployee({ id: 'emp-1', managerEmployeeId: 'emp-2' }),
      'emp-2': makeEmployee({ id: 'emp-2' }),
    };
    const { service } = makeService({ employees });
    await expect(service.assignManager(ORG, 'emp-2', 'emp-1')).rejects.toThrow(BadRequestException);
  });

  it('accepts a valid manager assignment', async () => {
    const employees = {
      'emp-1': makeEmployee({ id: 'emp-1' }),
      'emp-2': makeEmployee({ id: 'emp-2' }),
    };
    const { service } = makeService({ employees });
    const updated = await service.assignManager(ORG, 'emp-1', 'emp-2');
    expect(updated.managerEmployeeId).toBe('emp-2');
  });

  it('allows manager reassignment to a different valid manager', async () => {
    const employees = {
      'emp-1': makeEmployee({ id: 'emp-1', managerEmployeeId: 'emp-2' }),
      'emp-2': makeEmployee({ id: 'emp-2' }),
      'emp-3': makeEmployee({ id: 'emp-3' }),
    };
    const { service } = makeService({ employees });
    const updated = await service.assignManager(ORG, 'emp-1', 'emp-3');
    expect(updated.managerEmployeeId).toBe('emp-3');
  });

  it('rejects a separated employee being assigned as manager', async () => {
    const employees = {
      'emp-1': makeEmployee({ id: 'emp-1' }),
      'emp-2': makeEmployee({ id: 'emp-2', employmentStatus: 'SEPARATED' }),
    };
    const { service } = makeService({ employees });
    await expect(service.assignManager(ORG, 'emp-1', 'emp-2')).rejects.toThrow(BadRequestException);
  });

  it('allows a null manager — not every employee needs one', async () => {
    const { service } = makeService();
    const updated = await service.assignManager(ORG, 'emp-1', null);
    expect(updated.managerEmployeeId).toBeNull();
  });
});

describe('EmployeeService — user linking', () => {
  it('links a valid, same-organisation user', async () => {
    const { service } = makeService();
    const updated = await service.linkUser(ORG, 'emp-1', 'user-1');
    expect(updated.userId).toBe('user-1');
  });

  it('rejects linking a user from a different organisation', async () => {
    const users = { 'user-1': { id: 'user-1', organisationId: OTHER_ORG } };
    const { service } = makeService({ users });
    await expect(service.linkUser(ORG, 'emp-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects linking a user already linked to a different employee', async () => {
    const employees = {
      'emp-1': makeEmployee({ id: 'emp-1' }),
      'emp-2': makeEmployee({ id: 'emp-2', userId: 'user-1' }),
    };
    const { service } = makeService({ employees });
    await expect(service.linkUser(ORG, 'emp-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('unlink() removes the link without deleting the User (the repository is never asked to touch the users table)', async () => {
    const employees = { 'emp-1': makeEmployee({ id: 'emp-1', userId: 'user-1' }) };
    const { service, employeeRepository } = makeService({ employees });
    const updated = await service.unlinkUser(ORG, 'emp-1');
    expect(updated.userId).toBeNull();
    expect(employeeRepository.unlinkUser).toHaveBeenCalledWith(ORG, 'emp-1');
  });

  it('an employee can exist and be read without ever being linked to a user', async () => {
    const { service } = makeService();
    const employee = await service.getById(ORG, 'emp-1');
    expect(employee.userId).toBeNull();
  });
});

describe('EmployeeService — tenant isolation', () => {
  it('getById() throws NotFoundException for an employee in a different organisation', async () => {
    const { service } = makeService();
    await expect(service.getById(OTHER_ORG, 'emp-1')).rejects.toThrow(NotFoundException);
  });

  it('assignManager() cannot reach an employee belonging to another organisation', async () => {
    const { service } = makeService();
    await expect(service.assignManager(OTHER_ORG, 'emp-1', null)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('linkUser() cannot reach an employee belonging to another organisation', async () => {
    const { service } = makeService();
    await expect(service.linkUser(OTHER_ORG, 'emp-1', 'user-1')).rejects.toThrow(NotFoundException);
  });
});
