import { BadRequestException } from '@nestjs/common';

import { AttendanceService } from './attendance.service';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

function makeEmployee(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'emp-1',
    organisationId: ORG,
    userId: 'user-1',
    employmentStatus: 'ACTIVE',
    workScheduleId: null,
    ...overrides,
  };
}

function makeSchedule(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ws-1',
    organisationId: ORG,
    expectedStartTime: '09:00',
    expectedEndTime: '17:00',
    gracePeriodMinutes: 10,
    ...overrides,
  };
}

function makeService(options?: {
  employee?: Record<string, unknown> | null;
  schedule?: Record<string, unknown> | null;
  timeZone?: string;
}) {
  const employee = options?.employee !== undefined ? options.employee : makeEmployee();
  const schedule = options?.schedule !== undefined ? options.schedule : null;
  const timeZone = options?.timeZone ?? 'UTC';

  const records: Record<string, Record<string, unknown>> = {};
  let nextId = 1;

  const attendanceRepository = {
    findById: jest.fn(async (org: string, id: string) => {
      const r = records[id];
      return r && r.organisationId === org ? r : null;
    }),
    findByIdWithRelations: jest.fn(async (org: string, id: string) => {
      const r = records[id];
      return r && r.organisationId === org ? r : null;
    }),
    findByEmployeeAndDate: jest.fn(
      async (org: string, employeeId: string, attendanceDate: Date) => {
        return (
          Object.values(records).find(
            (r) =>
              r.organisationId === org &&
              r.employeeId === employeeId &&
              (r.attendanceDate as Date).getTime() === attendanceDate.getTime(),
          ) ?? null
        );
      },
    ),
    findManyByEmployeeInRange: jest.fn(async () => Object.values(records)),
    findOrCreateForDate: jest.fn(
      async (data: {
        organisationId: string;
        employeeId: string;
        attendanceDate: Date;
        workScheduleId?: string | null;
      }) => {
        const existing = Object.values(records).find(
          (r) =>
            r.organisationId === data.organisationId &&
            r.employeeId === data.employeeId &&
            (r.attendanceDate as Date).getTime() === data.attendanceDate.getTime(),
        );
        if (existing) return { attendanceRecord: existing, wasCreated: false };
        const id = `att-${nextId++}`;
        const created = {
          id,
          organisationId: data.organisationId,
          employeeId: data.employeeId,
          attendanceDate: data.attendanceDate,
          workScheduleId: data.workScheduleId ?? null,
          signInAt: null,
          signOutAt: null,
          status: 'PENDING_REVIEW',
          reviewStatus: 'NOT_REVIEWED',
          source: 'SELF_SERVICE',
        };
        records[id] = created;
        return { attendanceRecord: created, wasCreated: true };
      },
    ),
    update: jest.fn(async (org: string, id: string, data: Record<string, unknown>) => {
      const r = records[id];
      if (!r || r.organisationId !== org) return null;
      records[id] = { ...r, ...data };
      return records[id];
    }),
    markPastIncomplete: jest.fn(async (org: string, todayBucket: Date) => {
      for (const r of Object.values(records)) {
        if (
          r.organisationId === org &&
          (r.attendanceDate as Date).getTime() < todayBucket.getTime() &&
          r.signInAt &&
          !r.signOutAt &&
          ['PRESENT', 'LATE'].includes(r.status as string)
        ) {
          r.status = 'INCOMPLETE';
        }
      }
    }),
    findManyPaginated: jest.fn(async () => ({
      items: Object.values(records),
      total: Object.keys(records).length,
    })),
  };

  const employeeRepository = {
    findByUserId: jest.fn(async (org: string, userId: string) =>
      employee && employee.organisationId === org && employee.userId === userId ? employee : null,
    ),
    findById: jest.fn(async (org: string, id: string) =>
      employee && employee.organisationId === org && employee.id === id ? employee : null,
    ),
  };

  const workScheduleRepository = {
    findById: jest.fn(async (org: string, id: string) =>
      schedule && schedule.organisationId === org && schedule.id === id ? schedule : null,
    ),
  };

  const organisationService = {
    getById: jest.fn(async () => ({ timeZone })),
  };

  const service = new AttendanceService(
    attendanceRepository as never,
    employeeRepository as never,
    workScheduleRepository as never,
    organisationService as never,
  );
  return { service, attendanceRepository, employeeRepository, records };
}

describe('AttendanceService — self-service sign-in/out', () => {
  it('signIn(): creates a record and marks PRESENT when no schedule is assigned', async () => {
    const { service } = makeService();
    const { attendanceRecord, transitioned } = await service.signIn(ORG, 'user-1', {});
    expect(transitioned).toBe(true);
    expect(attendanceRecord.signInAt).not.toBeNull();
    expect(attendanceRecord.status).toBe('PRESENT');
  });

  it('signIn(): repeated call for the same day is idempotent — no duplicate, transitioned false', async () => {
    const { service, records } = makeService();
    await service.signIn(ORG, 'user-1', {});
    const { transitioned } = await service.signIn(ORG, 'user-1', {});
    expect(transitioned).toBe(false);
    expect(Object.keys(records)).toHaveLength(1);
  });

  it('signIn(): rejects a separated employee', async () => {
    const { service } = makeService({ employee: makeEmployee({ employmentStatus: 'SEPARATED' }) });
    await expect(service.signIn(ORG, 'user-1', {})).rejects.toThrow(BadRequestException);
  });

  it('signIn(): rejects an inactive (non-ACTIVE) employee', async () => {
    const { service } = makeService({ employee: makeEmployee({ employmentStatus: 'ONBOARDING' }) });
    await expect(service.signIn(ORG, 'user-1', {})).rejects.toThrow(BadRequestException);
  });

  it('signIn(): rejects when no employee is linked to the user', async () => {
    const { service } = makeService({ employee: null });
    await expect(service.signIn(ORG, 'user-1', {})).rejects.toThrow(BadRequestException);
  });

  it('signIn(): records optional location capture', async () => {
    const { service } = makeService();
    const { attendanceRecord } = await service.signIn(ORG, 'user-1', {
      location: { latitude: 6.5, longitude: 3.4, accuracyMeters: 12, locationLabel: 'HQ' },
    });
    expect(attendanceRecord.signInLatitude).toBe(6.5);
    expect(attendanceRecord.signInLocationLabel).toBe('HQ');
  });

  it('signIn(): missing location is handled safely (no fabricated coordinates)', async () => {
    const { service } = makeService();
    const { attendanceRecord } = await service.signIn(ORG, 'user-1', {});
    expect(attendanceRecord.signInLatitude).toBeUndefined();
  });

  it('signOut(): rejects signing out before signing in', async () => {
    const { service } = makeService();
    await expect(service.signOut(ORG, 'user-1', {})).rejects.toThrow(BadRequestException);
  });

  it('signOut(): succeeds after sign-in', async () => {
    const { service } = makeService();
    await service.signIn(ORG, 'user-1', {});
    const { attendanceRecord, transitioned } = await service.signOut(ORG, 'user-1', {});
    expect(transitioned).toBe(true);
    expect(attendanceRecord.signOutAt).not.toBeNull();
  });

  it('signOut(): repeated call is safely idempotent', async () => {
    const { service } = makeService();
    await service.signIn(ORG, 'user-1', {});
    await service.signOut(ORG, 'user-1', {});
    const { transitioned } = await service.signOut(ORG, 'user-1', {});
    expect(transitioned).toBe(false);
  });

  it('deriveSignInStatus: marks LATE when signing in after the schedule’s grace period', async () => {
    const { service } = makeService({
      employee: makeEmployee({ workScheduleId: 'ws-1' }),
      schedule: makeSchedule(),
    });
    jest.useFakeTimers().setSystemTime(new Date('2026-03-05T10:00:00.000Z')); // 10:00 UTC > 09:10
    const { attendanceRecord } = await service.signIn(ORG, 'user-1', {});
    expect(attendanceRecord.status).toBe('LATE');
    jest.useRealTimers();
  });

  it('deriveSignInStatus: marks PRESENT when signing in within the grace period', async () => {
    const { service } = makeService({
      employee: makeEmployee({ workScheduleId: 'ws-1' }),
      schedule: makeSchedule(),
    });
    jest.useFakeTimers().setSystemTime(new Date('2026-03-05T09:05:00.000Z')); // within grace
    const { attendanceRecord } = await service.signIn(ORG, 'user-1', {});
    expect(attendanceRecord.status).toBe('PRESENT');
    jest.useRealTimers();
  });
});

describe('AttendanceService — past-day incomplete derivation', () => {
  it('list(): flips a past day’s dangling sign-in (no sign-out) to INCOMPLETE, never touching today', async () => {
    const { service, records } = makeService();
    records['past'] = {
      id: 'past',
      organisationId: ORG,
      employeeId: 'emp-1',
      attendanceDate: new Date('2020-01-01T00:00:00.000Z'),
      signInAt: new Date('2020-01-01T09:00:00.000Z'),
      signOutAt: null,
      status: 'PRESENT',
    };
    await service.list(ORG, { page: 1, pageSize: 20 });
    expect(records['past'].status).toBe('INCOMPLETE');
  });
});

describe('AttendanceService — administrative entry', () => {
  it('administrativeEntry(): rejects a cross-tenant employee', async () => {
    const { service } = makeService();
    await expect(
      service.administrativeEntry(OTHER_ORG, {
        employeeId: 'emp-1',
        attendanceDate: new Date('2026-03-01T00:00:00.000Z'),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('administrativeEntry(): rejects a future attendance date', async () => {
    const { service } = makeService();
    const future = new Date(Date.now() + 10 * 86400000);
    await expect(
      service.administrativeEntry(ORG, { employeeId: 'emp-1', attendanceDate: future }),
    ).rejects.toThrow(BadRequestException);
  });

  it('administrativeEntry(): records a sign-in without requiring location', async () => {
    const { service } = makeService();
    const record = await service.administrativeEntry(ORG, {
      employeeId: 'emp-1',
      attendanceDate: new Date('2026-03-01T00:00:00.000Z'),
      signIn: true,
    });
    expect(record.signInAt).not.toBeNull();
    expect(record.source).toBe('ADMINISTRATIVE');
  });

  it('administrativeEntry(): rejects a sign-out with no prior sign-in', async () => {
    const { service } = makeService();
    await expect(
      service.administrativeEntry(ORG, {
        employeeId: 'emp-1',
        attendanceDate: new Date('2026-03-01T00:00:00.000Z'),
        signOut: true,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
