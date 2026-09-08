import { BadRequestException, Injectable } from '@nestjs/common';
import { RecordDowntimeInput } from '@zentuva/validation';

import { WorkOrderRepository } from './work-order.repository';
import {
  AssetDowntimeRepository,
  ListDowntimeParams,
  RecordDowntimeResult,
} from './asset-downtime.repository';

export interface DowntimeResponse {
  id: string;
  assetId: string;
  workOrderId: string;
  startedAt: Date;
  endedAt: Date | null;
  /** Always computed — never stored (docs/domains/maintenance.md
   *  "Downtime Foundation"). Null while the downtime window is still open. */
  durationMinutes: number | null;
  reason: string | null;
  planned: boolean;
  recordedById: string | null;
  createdAt: Date;
}

/** Domain service for `AssetDowntime` (Sprint 21, docs/domains/maintenance.md). */
@Injectable()
export class AssetDowntimeService {
  constructor(
    private readonly assetDowntimeRepository: AssetDowntimeRepository,
    private readonly workOrderRepository: WorkOrderRepository,
  ) {}

  async list(organisationId: string, params?: ListDowntimeParams): Promise<DowntimeResponse[]> {
    const items = await this.assetDowntimeRepository.findMany(organisationId, params);
    return items.map(toDowntimeResponse);
  }

  async record(
    organisationId: string,
    input: RecordDowntimeInput,
    actorUserId: string,
  ): Promise<RecordDowntimeResult> {
    const workOrder = await this.workOrderRepository.findById(organisationId, input.workOrderId);
    if (!workOrder) {
      throw new BadRequestException('Work order not found');
    }
    return this.assetDowntimeRepository.record({
      organisationId,
      assetId: workOrder.assetId,
      workOrderId: input.workOrderId,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      reason: input.reason,
      planned: input.planned,
      idempotencyKey: input.idempotencyKey,
      recordedById: actorUserId,
    });
  }

  async end(organisationId: string, id: string, endedAt?: Date): Promise<DowntimeResponse> {
    const updated = await this.assetDowntimeRepository.end(
      organisationId,
      id,
      endedAt ?? new Date(),
    );
    return toDowntimeResponse(updated);
  }
}

export function toDowntimeResponse(downtime: {
  id: string;
  assetId: string;
  workOrderId: string;
  startedAt: Date;
  endedAt: Date | null;
  reason: string | null;
  planned: boolean;
  recordedById: string | null;
  createdAt: Date;
}): DowntimeResponse {
  return {
    id: downtime.id,
    assetId: downtime.assetId,
    workOrderId: downtime.workOrderId,
    startedAt: downtime.startedAt,
    endedAt: downtime.endedAt,
    durationMinutes: downtime.endedAt
      ? Math.round((downtime.endedAt.getTime() - downtime.startedAt.getTime()) / 60000)
      : null,
    reason: downtime.reason,
    planned: downtime.planned,
    recordedById: downtime.recordedById,
    createdAt: downtime.createdAt,
  };
}
