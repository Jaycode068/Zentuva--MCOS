import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AttendanceCorrectionService } from './attendance-correction.service';

const ORG = 'org-1';

function makeRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'att-1',
    organisationId: ORG,
    employeeId: 'emp-1',
    signInAt: new Date('2026-03-05T09:30:00.000Z'),
    signOutAt: null,
    reviewStatus: 'NOT_REVIEWED',
    ...overrides,
  };
}

function makeCorrection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'corr-1',
    organisationId: ORG,
    attendanceRecordId: 'att-1',
    requestedByEmployeeId: 'emp-1',
    requestedByUserId: 'user-1',
    requestedSignInAt: new Date('2026-03-05T09:00:00.000Z'),
    requestedSignOutAt: null,
    reason: 'Clock was slow',
    status: 'REQUESTED',
    ...overrides,
  };
}

function makeService(options?: {
  record?: Record<string, unknown> | null;
  corrections?: Record<string, Record<string, unknown>>;
  employee?: Record<string, unknown> | null;
}) {
  const record = options?.record !== undefined ? options.record : makeRecord();
  const corrections = options?.corrections ?? {};
  const employee =
    options?.employee !== undefined
      ? options.employee
      : { id: 'emp-1', organisationId: ORG, userId: 'user-1' };

  const correctionRepository = {
    findById: jest.fn(async (org: string, id: string) => {
      const c = corrections[id];
      return c && c.organisationId === org ? c : null;
    }),
    findPendingByAttendanceRecord: jest.fn(
      async (org: string, attendanceRecordId: string) =>
        Object.values(corrections).find(
          (c) =>
            c.organisationId === org &&
            c.attendanceRecordId === attendanceRecordId &&
            c.status === 'REQUESTED',
        ) ?? null,
    ),
    findManyByAttendanceRecord: jest.fn(async (org: string, attendanceRecordId: string) =>
      Object.values(corrections).filter(
        (c) => c.organisationId === org && c.attendanceRecordId === attendanceRecordId,
      ),
    ),
    create: jest.fn(async (data: Record<string, unknown>) => {
      const id = `corr-${Object.keys(corrections).length + 1}`;
      const created = { id, status: 'REQUESTED', ...data };
      corrections[id] = created;
      return created;
    }),
    review: jest.fn(
      async (
        org: string,
        id: string,
        decisionData: Record<string, unknown>,
        attendanceRecordChanges: {
          attendanceRecordId: string;
          changes: Record<string, unknown>;
        } | null,
      ) => {
        const c = corrections[id];
        if (!c || c.organisationId !== org || c.status !== 'REQUESTED') return null;
        corrections[id] = { ...c, ...decisionData };
        if (attendanceRecordChanges && record) {
          Object.assign(record, attendanceRecordChanges.changes);
        }
        return corrections[id];
      },
    ),
  };

  const attendanceRepository = {
    findById: jest.fn(async (org: string, id: string) =>
      record && record.organisationId === org && record.id === id ? record : null,
    ),
  };

  const employeeRepository = {
    findByUserId: jest.fn(async (org: string, userId: string) =>
      employee && employee.organisationId === org && employee.userId === userId ? employee : null,
    ),
  };

  const service = new AttendanceCorrectionService(
    correctionRepository as never,
    attendanceRepository as never,
    employeeRepository as never,
  );
  return { service, correctionRepository, record, corrections };
}

describe('AttendanceCorrectionService — request', () => {
  it('creates a correction request for the record’s own employee', async () => {
    const { service } = makeService();
    const correction = await service.request(ORG, 'att-1', 'user-1', {
      requestedSignInAt: new Date('2026-03-05T09:00:00.000Z'),
      reason: 'Clock was slow',
    });
    expect(correction.status).toBe('REQUESTED');
  });

  it('rejects a request with neither a sign-in nor sign-out change', async () => {
    const { service } = makeService();
    await expect(
      service.request(ORG, 'att-1', 'user-1', { reason: 'No change' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a duplicate pending correction for the same attendance record', async () => {
    const { service } = makeService({
      corrections: { 'corr-1': makeCorrection() },
    });
    await expect(
      service.request(ORG, 'att-1', 'user-1', {
        requestedSignInAt: new Date(),
        reason: 'Another reason',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a user requesting a correction for someone else’s attendance record', async () => {
    const { service } = makeService({
      employee: { id: 'emp-2', organisationId: ORG, userId: 'user-2' },
    });
    await expect(
      service.request(ORG, 'att-1', 'user-2', {
        requestedSignInAt: new Date(),
        reason: 'Not mine',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a correction request against a nonexistent attendance record', async () => {
    const { service } = makeService({ record: null });
    await expect(
      service.request(ORG, 'att-missing', 'user-1', {
        requestedSignInAt: new Date(),
        reason: 'x',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('AttendanceCorrectionService — review', () => {
  it('approval applies the requested sign-in time to the attendance record atomically', async () => {
    const { service, record } = makeService({ corrections: { 'corr-1': makeCorrection() } });
    await service.review(ORG, 'corr-1', 'admin-1', { decision: 'APPROVED' });
    expect((record as Record<string, unknown>).signInAt).toEqual(
      new Date('2026-03-05T09:00:00.000Z'),
    );
    expect((record as Record<string, unknown>).reviewStatus).toBe('APPROVED');
  });

  it('rejection leaves the original attendance record unchanged', async () => {
    const { service, record } = makeService({ corrections: { 'corr-1': makeCorrection() } });
    const originalSignIn = (record as Record<string, unknown>).signInAt;
    await service.review(ORG, 'corr-1', 'admin-1', { decision: 'REJECTED' });
    expect((record as Record<string, unknown>).signInAt).toBe(originalSignIn);
  });

  it('rejects reviewing an already-reviewed correction', async () => {
    const { service } = makeService({
      corrections: { 'corr-1': makeCorrection({ status: 'APPROVED' }) },
    });
    await expect(
      service.review(ORG, 'corr-1', 'admin-1', { decision: 'APPROVED' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects the requester approving their own correction', async () => {
    const { service } = makeService({ corrections: { 'corr-1': makeCorrection() } });
    await expect(service.review(ORG, 'corr-1', 'user-1', { decision: 'APPROVED' })).rejects.toThrow(
      BadRequestException,
    );
  });
});
