import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AssetMeter, AssetMeterType } from '@prisma/client';
import { CreateAssetMeterInput, RecordMeterReadingInput } from '@zentuva/validation';

import { AssetRepository } from './asset.repository';
import {
  AssetMeterRepository,
  InvalidMeterReadingError,
  RecordMeterReadingResult,
} from './asset-meter.repository';

/** Domain service for `AssetMeter`/`AssetMeterReading` (Sprint 20,
 *  docs/domains/assets.md). */
@Injectable()
export class AssetMeterService {
  constructor(
    private readonly assetMeterRepository: AssetMeterRepository,
    private readonly assetRepository: AssetRepository,
  ) {}

  list(organisationId: string, assetId: string): Promise<AssetMeter[]> {
    return this.assetMeterRepository.findManyByAsset(organisationId, assetId);
  }

  listReadings(organisationId: string, meterId: string) {
    return this.assetMeterRepository.findReadings(organisationId, meterId);
  }

  async create(
    organisationId: string,
    assetId: string,
    input: CreateAssetMeterInput,
    actorUserId: string,
  ): Promise<AssetMeter> {
    const asset = await this.assetRepository.findById(organisationId, assetId);
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }
    return this.assetMeterRepository.create({
      organisationId,
      assetId,
      meterType: input.meterType as AssetMeterType,
      unit: input.unit,
      createdById: actorUserId,
    });
  }

  async recordReading(
    organisationId: string,
    meterId: string,
    input: RecordMeterReadingInput,
    actorUserId: string,
  ): Promise<RecordMeterReadingResult> {
    try {
      return await this.assetMeterRepository.recordReading({
        organisationId,
        meterId,
        reading: input.reading,
        readingDate: input.readingDate,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
        recordedById: actorUserId,
      });
    } catch (error) {
      if (error instanceof InvalidMeterReadingError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
