import { BadRequestException, NotFoundException } from '@nestjs/common';

import { DepartmentService } from './department.service';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

function makeDepartment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'dept-1',
    organisationId: ORG,
    code: 'PROD',
    name: 'Production',
    parentDepartmentId: null,
    departmentHeadEmployeeId: null,
    status: 'ACTIVE',
    ...overrides,
  };
}

function makeService(options?: {
  departments?: Record<string, Record<string, unknown>>;
  employees?: Record<string, Record<string, unknown>>;
}) {
  const departments: Record<string, Record<string, unknown>> = options?.departments ?? {
    'dept-1': makeDepartment(),
  };
  const employees: Record<string, Record<string, unknown>> = options?.employees ?? {};

  const departmentRepository = {
    findById: jest.fn(async (org: string, id: string) => {
      const d = departments[id];
      return d && d.organisationId === org ? d : null;
    }),
    getParentId: jest.fn(async (id: string) => departments[id]?.parentDepartmentId ?? null),
    create: jest.fn(async (data: Record<string, unknown>) => ({
      department: { ...makeDepartment(), ...data, id: 'dept-new' },
      wasCreated: true,
    })),
    update: jest.fn(async (org: string, id: string, data: Record<string, unknown>) => {
      const d = departments[id];
      if (!d || d.organisationId !== org) return null;
      return { ...d, ...data };
    }),
    activate: jest.fn(async (org: string, id: string) => {
      const d = departments[id];
      return d && d.organisationId === org ? { ...d, status: 'ACTIVE' } : null;
    }),
    deactivate: jest.fn(async (org: string, id: string) => {
      const d = departments[id];
      return d && d.organisationId === org ? { ...d, status: 'INACTIVE' } : null;
    }),
    countEmployees: jest.fn(async () => 0),
    findManyByOrganisation: jest.fn(async () => Object.values(departments)),
  };

  const employeeRepository = {
    findById: jest.fn(async (org: string, id: string) => {
      const e = employees[id];
      return e && e.organisationId === org ? e : null;
    }),
  };

  const service = new DepartmentService(departmentRepository as never, employeeRepository as never);
  return { service, departmentRepository, employeeRepository };
}

describe('DepartmentService', () => {
  it('create(): rejects a department that names itself as parent — impossible on create since id does not exist yet, but rejects an unknown parent', async () => {
    const { service } = makeService({ departments: {} });
    await expect(
      service.create(ORG, { code: 'X', name: 'X', parentDepartmentId: 'missing' } as never, 'u1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('update(): rejects setting a department as its own parent (self-reference)', async () => {
    const { service } = makeService();
    await expect(
      service.update(ORG, 'dept-1', { parentDepartmentId: 'dept-1' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('update(): rejects a circular parent hierarchy (dept-1 -> dept-2 -> dept-1)', async () => {
    const departments = {
      'dept-1': makeDepartment({ id: 'dept-1', parentDepartmentId: 'dept-2' }),
      'dept-2': makeDepartment({ id: 'dept-2', code: 'D2', name: 'D2', parentDepartmentId: null }),
    };
    const { service } = makeService({ departments });
    await expect(
      service.update(ORG, 'dept-2', { parentDepartmentId: 'dept-1' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('update(): allows a valid, non-circular parent assignment', async () => {
    const departments = {
      'dept-1': makeDepartment({ id: 'dept-1' }),
      'dept-2': makeDepartment({ id: 'dept-2', code: 'D2', name: 'D2' }),
    };
    const { service } = makeService({ departments });
    const updated = await service.update(ORG, 'dept-2', {
      parentDepartmentId: 'dept-1',
    } as never);
    expect(updated.parentDepartmentId).toBe('dept-1');
  });

  it('create(): rejects a department head from a different organisation', async () => {
    const employees = {
      'emp-1': { id: 'emp-1', organisationId: OTHER_ORG, employmentStatus: 'ACTIVE' },
    };
    const { service } = makeService({ departments: {}, employees });
    await expect(
      service.create(
        ORG,
        { code: 'X', name: 'X', departmentHeadEmployeeId: 'emp-1' } as never,
        'u1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('create(): rejects a separated employee as department head', async () => {
    const employees = {
      'emp-1': { id: 'emp-1', organisationId: ORG, employmentStatus: 'SEPARATED' },
    };
    const { service } = makeService({ departments: {}, employees });
    await expect(
      service.create(
        ORG,
        { code: 'X', name: 'X', departmentHeadEmployeeId: 'emp-1' } as never,
        'u1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('create(): accepts a valid, same-organisation, active department head', async () => {
    const employees = { 'emp-1': { id: 'emp-1', organisationId: ORG, employmentStatus: 'ACTIVE' } };
    const { service, departmentRepository } = makeService({ departments: {}, employees });
    await service.create(
      ORG,
      { code: 'X', name: 'X', departmentHeadEmployeeId: 'emp-1' } as never,
      'u1',
    );
    expect(departmentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ departmentHeadEmployeeId: 'emp-1' }),
    );
  });

  it('tenant isolation: getById() throws NotFoundException for a department in a different organisation', async () => {
    const { service } = makeService();
    await expect(service.getById(OTHER_ORG, 'dept-1')).rejects.toThrow(NotFoundException);
  });

  it('tenant isolation: update() cannot reach a department belonging to another organisation', async () => {
    const { service } = makeService();
    await expect(service.update(OTHER_ORG, 'dept-1', { name: 'Hacked' } as never)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('deactivate()/activate() flip status and can be reversed', async () => {
    const { service } = makeService();
    const deactivated = await service.deactivate(ORG, 'dept-1');
    expect(deactivated.status).toBe('INACTIVE');
    const activated = await service.activate(ORG, 'dept-1');
    expect(activated.status).toBe('ACTIVE');
  });
});
