import { Injectable } from '@nestjs/common';
import { AssetMeter, AssetMeterReading, AssetMeterType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface CreateAssetMeterData {
  organisationId: string;
  assetId: string;
  meterType: AssetMeterType;
  unit: string;
  createdById: string;
}

export interface RecordMeterReadingData {
  organisationId: string;
  meterId: string;
  reading: number;
  readingDate?: Date;
  notes?: string;
  idempotencyKey?: string;
  recordedById: string;
}

export interface RecordMeterReadingResult {
  reading: AssetMeterReading;
  meter: AssetMeter;
  wasCreated: boolean;
}

/**
 * Thin Prisma access for `AssetMeter`/`AssetMeterReading` (Sprint 20,
 * docs/domains/assets.md "Meter / Reading Foundation"). Not IoT — a
 * simple, manually-recorded cumulative-reading log, the exact foundation
 * Sprint 21's preventive-maintenance engine will read from.
 */
@Injectable()
export class AssetMeterRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<AssetMeter | null> {
    return this.prisma.assetMeter.findFirst({ where: { id, organisationId } });
  }

  findManyByAsset(organisationId: string, assetId: string): Promise<AssetMeter[]> {
    return this.prisma.assetMeter.findMany({
      where: { organisationId, assetId },
      orderBy: { meterType: 'asc' },
    });
  }

  findReadings(organisationId: string, meterId: string): Promise<AssetMeterReading[]> {
    return this.prisma.assetMeterReading.findMany({
      where: { organisationId, meterId },
      orderBy: { readingDate: 'desc' },
    });
  }

  create(data: CreateAssetMeterData): Promise<AssetMeter> {
    return this.prisma.assetMeter.create({
      data: {
        organisationId: data.organisationId,
        assetId: data.assetId,
        meterType: data.meterType,
        unit: data.unit,
        createdById: data.createdById,
      },
    });
  }

  /** Atomic: validates the new reading is not below the meter's current
   *  one (meters are cumulative), inserts the immutable log row, and
   *  updates the meter's own `currentReading`/`lastReadingDate` mirror —
   *  all inside one transaction. Idempotency-check-first. */
  async recordReading(data: RecordMeterReadingData): Promise<RecordMeterReadingResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.assetMeterReading.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          const meter = await tx.assetMeter.findUniqueOrThrow({ where: { id: data.meterId } });
          return { reading: existing, meter, wasCreated: false };
        }
      }

      const meter = await tx.assetMeter.findFirstOrThrow({
        where: { id: data.meterId, organisationId: data.organisationId },
      });

      if (data.reading < meter.currentReading) {
        throw new InvalidMeterReadingError(meter.currentReading, data.reading);
      }

      const readingDate = data.readingDate ?? new Date();
      const reading = await tx.assetMeterReading.create({
        data: {
          organisationId: data.organisationId,
          meterId: data.meterId,
          reading: data.reading,
          readingDate,
          recordedById: data.recordedById,
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
        },
      });

      const updatedMeter = await tx.assetMeter.update({
        where: { id: data.meterId },
        data: { currentReading: data.reading, lastReadingDate: readingDate },
      });

      return { reading, meter: updatedMeter, wasCreated: true };
    });
  }
}

export class InvalidMeterReadingError extends Error {
  constructor(
    public readonly currentReading: number,
    public readonly attemptedReading: number,
  ) {
    super(
      `A new meter reading (${attemptedReading}) cannot be lower than the current reading (${currentReading}) — meters are cumulative`,
    );
  }
}
