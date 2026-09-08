import { BadRequestException } from '@nestjs/common';
import { MaintenanceRequestStatus } from '@prisma/client';

import { MaintenanceRequestService } from './maintenance-request.service';

const ORG = 'org-1';

function makeRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'req-1',
    organisationId: ORG,
    requestCode: 'MR-000001',
    assetId: 'asset-1',
    status: 'OPEN' as MaintenanceRequestStatus,
    ...overrides,
  };
}

function makeService(params: { request?: Record<string, unknown> } = {}) {
  const request = params.request ?? makeRequest();

  const maintenanceRequestRepository = {
    findById: jest.fn(async (_org: string, id: string) => (id === request.id ? request : null)),
    create: jest.fn(async () => ({ maintenanceRequest: request, wasCreated: true })),
    update: jest.fn(async (_org: string, _id: string, data: Record<string, unknown>) => ({
      ...request,
      ...data,
    })),
    setStatus: jest.fn(async (_org: string, _id: string, data: Record<string, unknown>) => ({
      ...request,
      ...data,
    })),
    convert: jest.fn(async () => ({
      maintenanceRequest: { ...request, status: 'CONVERTED_TO_WORK_ORDER' },
      workOrder: { id: 'wo-1', workOrderCode: 'WO-000001' },
      wasCreated: true,
    })),
  };
  const assetRepository = { findById: jest.fn(async () => ({ id: 'asset-1' })) };
  const maintenanceTypeRepository = { findById: jest.fn(async () => ({ id: 'type-1' })) };

  const service = new MaintenanceRequestService(
    maintenanceRequestRepository as never,
    assetRepository as never,
    maintenanceTypeRepository as never,
  );

  return { service, maintenanceRequestRepository, request };
}

describe('MaintenanceRequestService lifecycle', () => {
  it('approve(): OPEN -> APPROVED', async () => {
    const { service } = makeService({ request: makeRequest({ status: 'OPEN' }) });
    const { request, transitioned } = await service.approve(ORG, 'req-1', 'user-1');
    expect(transitioned).toBe(true);
    expect(request.status).toBe('APPROVED');
  });

  it('reject(): OPEN -> REJECTED, with reason', async () => {
    const { service } = makeService({ request: makeRequest({ status: 'OPEN' }) });
    const { request, transitioned } = await service.reject(
      ORG,
      'req-1',
      { rejectionReason: 'Duplicate report' },
      'user-1',
    );
    expect(transitioned).toBe(true);
    expect(request.status).toBe('REJECTED');
    expect(request.rejectionReason).toBe('Duplicate report');
  });

  it('cancel(): rejects cancelling an already-REJECTED (terminal) request', async () => {
    const { service } = makeService({ request: makeRequest({ status: 'REJECTED' }) });
    await expect(service.cancel(ORG, 'req-1')).rejects.toThrow(BadRequestException);
  });

  it('cancel(): rejects cancelling an already-CONVERTED_TO_WORK_ORDER request', async () => {
    const { service } = makeService({
      request: makeRequest({ status: 'CONVERTED_TO_WORK_ORDER' }),
    });
    await expect(service.cancel(ORG, 'req-1')).rejects.toThrow(BadRequestException);
  });

  it('approve(): rejects re-approving a REJECTED request', async () => {
    const { service } = makeService({ request: makeRequest({ status: 'REJECTED' }) });
    await expect(service.approve(ORG, 'req-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('update(): rejects editing a terminal (CONVERTED_TO_WORK_ORDER) request', async () => {
    const { service } = makeService({
      request: makeRequest({ status: 'CONVERTED_TO_WORK_ORDER' }),
    });
    await expect(service.update(ORG, 'req-1', { title: 'New title' } as never)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('convert(): rejects converting a request that has not been approved', async () => {
    const { service } = makeService({ request: makeRequest({ status: 'OPEN' }) });
    await expect(
      service.convert(ORG, 'req-1', { maintenanceTypeId: 'type-1' } as never, 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('convert(): succeeds from APPROVED, producing a work order', async () => {
    const { service } = makeService({ request: makeRequest({ status: 'APPROVED' }) });
    const result = await service.convert(
      ORG,
      'req-1',
      { maintenanceTypeId: 'type-1' } as never,
      'user-1',
    );
    expect(result.workOrder.id).toBe('wo-1');
    expect(result.maintenanceRequest.status).toBe('CONVERTED_TO_WORK_ORDER');
  });

  it("convert(): idempotent — re-calling convert() on an already-converted request delegates to the repository's own natural-idempotency, never re-validating APPROVED status", async () => {
    const { service, maintenanceRequestRepository } = makeService({
      request: makeRequest({ status: 'CONVERTED_TO_WORK_ORDER' }),
    });
    await service.convert(ORG, 'req-1', { maintenanceTypeId: 'type-1' } as never, 'user-1');
    expect(maintenanceRequestRepository.convert).toHaveBeenCalled();
  });
});
