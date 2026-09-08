import { BadRequestException } from '@nestjs/common';
import { WorkOrderStatus } from '@prisma/client';

import { WorkOrderService } from './work-order.service';

const ORG = 'org-1';

function makeWorkOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'wo-1',
    organisationId: ORG,
    workOrderCode: 'WO-000001',
    assetId: 'asset-1',
    maintenanceTypeId: 'type-1',
    status: 'OPEN' as WorkOrderStatus,
    assignedToId: null,
    actualStartAt: null,
    notes: null,
    tasks: [],
    ...overrides,
  };
}

function makeService(params: { workOrder?: Record<string, unknown>; assetStatus?: string } = {}) {
  const workOrder = params.workOrder ?? makeWorkOrder();

  const workOrderRepository = {
    findById: jest.fn(async (_org: string, id: string) => (id === workOrder.id ? workOrder : null)),
    create: jest.fn(async () => ({ workOrder, wasCreated: true })),
    update: jest.fn(async (_org: string, _id: string, data: Record<string, unknown>) => ({
      ...workOrder,
      ...data,
    })),
    setStatus: jest.fn(async (_org: string, _id: string, data: Record<string, unknown>) => ({
      ...workOrder,
      ...data,
    })),
    complete: jest.fn(async () => ({
      workOrder: { ...workOrder, status: 'COMPLETED' },
      wasCompleted: true,
    })),
    countOpenForAsset: jest.fn(async () => 0),
    findTasks: jest.fn(async () => []),
    addTask: jest.fn(async () => ({ id: 'task-1' })),
    updateTask: jest.fn(async () => ({ id: 'task-1', status: 'COMPLETED' })),
  };
  const assetRepository = {
    findById: jest.fn(async () => ({ id: 'asset-1', status: params.assetStatus ?? 'IN_SERVICE' })),
  };
  const assetService = {
    startMaintenance: jest.fn(async () => ({})),
    resumeService: jest.fn(async () => ({})),
  };
  const maintenanceTypeRepository = { findById: jest.fn(async () => ({ id: 'type-1' })) };
  const maintenanceRequestRepository = { findById: jest.fn(async () => ({ id: 'req-1' })) };
  const supplierRepository = { findById: jest.fn(async () => ({ id: 'sup-1' })) };

  const service = new WorkOrderService(
    workOrderRepository as never,
    assetRepository as never,
    assetService as never,
    maintenanceTypeRepository as never,
    maintenanceRequestRepository as never,
    supplierRepository as never,
  );

  return { service, workOrderRepository, assetService, assetRepository, workOrder };
}

describe('WorkOrderService lifecycle', () => {
  it('assign(): OPEN -> ASSIGNED', async () => {
    const { service } = makeService({ workOrder: makeWorkOrder({ status: 'OPEN' }) });
    const { workOrder, transitioned } = await service.assign(ORG, 'wo-1', 'tech-1');
    expect(transitioned).toBe(true);
    expect(workOrder.status).toBe('ASSIGNED');
    expect(workOrder.assignedToId).toBe('tech-1');
  });

  it('start(): ASSIGNED -> IN_PROGRESS, and starts asset maintenance when asset is IN_SERVICE', async () => {
    const { service, assetService } = makeService({
      workOrder: makeWorkOrder({ status: 'ASSIGNED', assignedToId: 'tech-1' }),
      assetStatus: 'IN_SERVICE',
    });
    const { workOrder, transitioned } = await service.start(ORG, 'wo-1');
    expect(transitioned).toBe(true);
    expect(workOrder.status).toBe('IN_PROGRESS');
    expect(assetService.startMaintenance).toHaveBeenCalledWith(ORG, 'asset-1');
  });

  it('start(): rejects starting an OPEN (unassigned) work order', async () => {
    const { service } = makeService({ workOrder: makeWorkOrder({ status: 'OPEN' }) });
    await expect(service.start(ORG, 'wo-1')).rejects.toThrow(BadRequestException);
  });

  it('start(): does not force the asset transition when the asset is not IN_SERVICE', async () => {
    const { service, assetService } = makeService({
      workOrder: makeWorkOrder({ status: 'ASSIGNED', assignedToId: 'tech-1' }),
      assetStatus: 'DRAFT',
    });
    await service.start(ORG, 'wo-1');
    expect(assetService.startMaintenance).not.toHaveBeenCalled();
  });

  it('start(): soft-idempotent — already IN_PROGRESS returns unchanged, no error', async () => {
    const { service } = makeService({ workOrder: makeWorkOrder({ status: 'IN_PROGRESS' }) });
    const { transitioned } = await service.start(ORG, 'wo-1');
    expect(transitioned).toBe(false);
  });

  it('hold(): IN_PROGRESS -> ON_HOLD', async () => {
    const { service } = makeService({ workOrder: makeWorkOrder({ status: 'IN_PROGRESS' }) });
    const { workOrder, transitioned } = await service.hold(ORG, 'wo-1', 'waiting for part');
    expect(transitioned).toBe(true);
    expect(workOrder.status).toBe('ON_HOLD');
  });

  it('hold(): rejects holding a work order that is not IN_PROGRESS', async () => {
    const { service } = makeService({ workOrder: makeWorkOrder({ status: 'OPEN' }) });
    await expect(service.hold(ORG, 'wo-1')).rejects.toThrow(BadRequestException);
  });

  it('resume(): ON_HOLD -> IN_PROGRESS', async () => {
    const { service } = makeService({ workOrder: makeWorkOrder({ status: 'ON_HOLD' }) });
    const { workOrder, transitioned } = await service.resume(ORG, 'wo-1');
    expect(transitioned).toBe(true);
    expect(workOrder.status).toBe('IN_PROGRESS');
  });

  it('cancel(): rejects cancelling a COMPLETED work order', async () => {
    const { service } = makeService({ workOrder: makeWorkOrder({ status: 'COMPLETED' }) });
    await expect(service.cancel(ORG, 'wo-1')).rejects.toThrow(BadRequestException);
  });

  it('cancel(): soft-idempotent — already CANCELLED returns unchanged, no error', async () => {
    const { service } = makeService({ workOrder: makeWorkOrder({ status: 'CANCELLED' }) });
    const { transitioned } = await service.cancel(ORG, 'wo-1');
    expect(transitioned).toBe(false);
  });

  it('cancel(): OPEN/ASSIGNED/IN_PROGRESS/ON_HOLD -> CANCELLED', async () => {
    for (const status of ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] as WorkOrderStatus[]) {
      const { service } = makeService({ workOrder: makeWorkOrder({ status }) });
      const { workOrder, transitioned } = await service.cancel(ORG, 'wo-1');
      expect(transitioned).toBe(true);
      expect(workOrder.status).toBe('CANCELLED');
    }
  });

  it('complete(): rejects completing a work order that is not IN_PROGRESS', async () => {
    const { service } = makeService({ workOrder: makeWorkOrder({ status: 'OPEN' }) });
    await expect(
      service.complete(ORG, 'wo-1', { resolution: 'Fixed it' } as never, 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('complete(): resumes the asset to IN_SERVICE when this was the only open work order', async () => {
    const { service, assetService, workOrderRepository } = makeService({
      workOrder: makeWorkOrder({ status: 'IN_PROGRESS' }),
      assetStatus: 'UNDER_MAINTENANCE',
    });
    workOrderRepository.countOpenForAsset.mockResolvedValue(0);

    await service.complete(ORG, 'wo-1', { resolution: 'Fixed it' } as never, 'user-1');
    expect(assetService.resumeService).toHaveBeenCalledWith(ORG, 'asset-1');
  });

  it('complete(): does NOT resume the asset while another work order is still open', async () => {
    const { service, assetService, workOrderRepository } = makeService({
      workOrder: makeWorkOrder({ status: 'IN_PROGRESS' }),
      assetStatus: 'UNDER_MAINTENANCE',
    });
    workOrderRepository.countOpenForAsset.mockResolvedValue(1);

    await service.complete(ORG, 'wo-1', { resolution: 'Fixed it' } as never, 'user-1');
    expect(assetService.resumeService).not.toHaveBeenCalled();
  });

  it('update(): rejects editing a work order once it is IN_PROGRESS', async () => {
    const { service } = makeService({ workOrder: makeWorkOrder({ status: 'IN_PROGRESS' }) });
    await expect(service.update(ORG, 'wo-1', { title: 'New title' } as never)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('WorkOrderService — invalid transitions rejected', () => {
  const invalidTransitions: [WorkOrderStatus, 'start' | 'hold' | 'resume' | 'complete'][] = [
    ['COMPLETED', 'start'],
    ['CANCELLED', 'start'],
    ['COMPLETED', 'hold'],
    ['OPEN', 'resume'],
    ['CANCELLED', 'complete'],
  ];

  it.each(invalidTransitions)('rejects %s -> %s', async (status, action) => {
    const { service } = makeService({ workOrder: makeWorkOrder({ status }) });
    if (action === 'complete') {
      await expect(
        service.complete(ORG, 'wo-1', { resolution: 'x' } as never, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    } else {
      await expect(service[action](ORG, 'wo-1')).rejects.toThrow(BadRequestException);
    }
  });
});
