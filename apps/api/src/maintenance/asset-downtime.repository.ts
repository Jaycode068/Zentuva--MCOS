import { BadRequestException, Injectable } from '@nestjs/common';
import { AssetDowntime } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListDowntimeParams {
  assetId?: string;
  workOrderId?: string;
  from?: Date;
  to?: Date;
}

export interface RecordDowntimeData {
  organisationId: string;
  assetId: string;
  workOrderId: string;
  startedAt: Date;
  endedAt?: Date;
  reason?: string;
  planned: boolean;
  idempotencyKey?: string;
  recordedById: string;
}

export interface RecordDowntimeResult {
  downtime: AssetDowntime;
  wasCreated: boolean;
}

/**
 * Thin Prisma access for `AssetDowntime` (Sprint 21, docs/domains/
 * maintenance.md "Downtime Foundation"). Duration is never stored —
 * always `endedAt − startedAt`, computed by the caller (service/API
 * response layer) at read time.
 */
@Injectable()
export class AssetDowntimeRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<AssetDowntime | null> {
    return this.prisma.assetDowntime.findFirst({ where: { id, organisationId } });
  }

  findMany(organisationId: string, params: ListDowntimeParams = {}): Promise<AssetDowntime[]> {
    return this.prisma.assetDowntime.findMany({
      where: {
        organisationId,
        ...(params.assetId ? { assetId: params.assetId } : {}),
        ...(params.workOrderId ? { workOrderId: params.workOrderId } : {}),
        ...(params.from || params.to
          ? {
              startedAt: {
                ...(params.from ? { gte: params.from } : {}),
                ...(params.to ? { lte: params.to } : {}),
              },
            }
          : {}),
      },
      orderBy: { startedAt: 'desc' },
    });
  }

  async record(data: RecordDowntimeData): Promise<RecordDowntimeResult> {
    if (data.endedAt && data.endedAt < data.startedAt) {
      throw new BadRequestException('endedAt cannot be before startedAt');
    }
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.assetDowntime.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { downtime: existing, wasCreated: false };
        }
      }

      const downtime = await tx.assetDowntime.create({
        data: {
          organisationId: data.organisationId,
          assetId: data.assetId,
          workOrderId: data.workOrderId,
          startedAt: data.startedAt,
          endedAt: data.endedAt,
          reason: data.reason,
          planned: data.planned,
          idempotencyKey: data.idempotencyKey,
          recordedById: data.recordedById,
        },
      });

      return { downtime, wasCreated: true };
    });
  }

  async end(organisationId: string, id: string, endedAt: Date): Promise<AssetDowntime> {
    const existing = await this.prisma.assetDowntime.findFirst({ where: { id, organisationId } });
    if (!existing) {
      throw new BadRequestException('Downtime record not found');
    }
    if (endedAt < existing.startedAt) {
      throw new BadRequestException('endedAt cannot be before startedAt');
    }
    if (existing.endedAt) {
      return existing;
    }
    const result = await this.prisma.assetDowntime.updateMany({
      where: { id, organisationId },
      data: { endedAt },
    });
    if (result.count === 0) {
      throw new BadRequestException('Downtime record not found');
    }
    return this.prisma.assetDowntime.findUniqueOrThrow({ where: { id } });
  }
}
