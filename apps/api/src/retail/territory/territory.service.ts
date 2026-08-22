import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Territory, TerritoryStatus } from '@prisma/client';
import { CreateTerritoryInput, UpdateTerritoryInput } from '@zentuva/validation';

import { ListTerritoriesParams, TerritoryRepository } from './territory.repository';

const TERRITORY_CODE_PREFIX = 'TER';
const TERRITORY_CODE_SEQUENCE_LENGTH = 6;

/** How many levels up `assertNoCycle` will walk before giving up — a hierarchy this deep
 *  would already indicate a data problem; this is a safety valve, not a real limit on
 *  legitimate territory depth. */
const MAX_HIERARCHY_DEPTH = 50;

/**
 * Domain service for the `Territory` aggregate (Sprint 4.8, docs/domains/territories.md).
 * A self-referential, organisation-defined hierarchy of arbitrary depth — no GIS, no
 * polygons, no fixed level count.
 */
@Injectable()
export class TerritoryService {
  constructor(private readonly territoryRepository: TerritoryRepository) {}

  getById(organisationId: string, id: string): Promise<Territory | null> {
    return this.territoryRepository.findById(organisationId, id);
  }

  list(organisationId: string, params?: ListTerritoriesParams): Promise<Territory[]> {
    return this.territoryRepository.findManyByOrganisation(organisationId, params);
  }

  /** New territories always start `ACTIVE`. */
  async create(
    organisationId: string,
    input: CreateTerritoryInput,
    actorUserId: string,
  ): Promise<Territory> {
    if (input.parentTerritoryId) {
      await this.assertParentExists(organisationId, input.parentTerritoryId);
    }
    const territoryCode = await this.generateUniqueCode();

    return this.territoryRepository.create({
      organisation: { connect: { id: organisationId } },
      territoryCode,
      name: input.name,
      type: input.type,
      description: input.description,
      status: TerritoryStatus.ACTIVE,
      createdById: actorUserId,
      updatedById: actorUserId,
      ...(input.parentTerritoryId
        ? { parentTerritory: { connect: { id: input.parentTerritoryId } } }
        : {}),
    });
  }

  /** Partial update — `territoryCode` is never accepted here (immutable). Re-parenting is
   *  a legitimate correction (unlike Product Variant's immutable family), so
   *  `parentTerritoryId` is accepted, guarded against forming a cycle. */
  async update(
    organisationId: string,
    id: string,
    input: UpdateTerritoryInput,
    actorUserId: string,
  ): Promise<Territory> {
    const existing = await this.getByIdOrThrow(organisationId, id);

    if (input.status !== undefined && existing.status === input.status) {
      throw new BadRequestException(`Territory is already ${input.status.toLowerCase()}`);
    }

    if (input.parentTerritoryId !== undefined && input.parentTerritoryId !== null) {
      if (input.parentTerritoryId === id) {
        throw new BadRequestException('A territory cannot be its own parent');
      }
      await this.assertParentExists(organisationId, input.parentTerritoryId);
      await this.assertNoCycle(organisationId, id, input.parentTerritoryId);
    }

    const updated = await this.territoryRepository.update(organisationId, id, {
      name: input.name,
      type: input.type,
      description: input.description,
      status: input.status,
      updatedById: actorUserId,
      ...(input.parentTerritoryId !== undefined
        ? { parentTerritoryId: input.parentTerritoryId }
        : {}),
    });
    if (!updated) {
      throw new NotFoundException('Territory not found');
    }
    return updated;
  }

  async activate(organisationId: string, id: string, actorUserId: string): Promise<Territory> {
    const territory = await this.getByIdOrThrow(organisationId, id);
    if (territory.status === TerritoryStatus.ACTIVE) {
      throw new BadRequestException('Territory is already active');
    }
    return this.setStatus(organisationId, id, TerritoryStatus.ACTIVE, actorUserId);
  }

  async deactivate(organisationId: string, id: string, actorUserId: string): Promise<Territory> {
    const territory = await this.getByIdOrThrow(organisationId, id);
    if (territory.status === TerritoryStatus.INACTIVE) {
      throw new BadRequestException('Territory is already inactive');
    }
    return this.setStatus(organisationId, id, TerritoryStatus.INACTIVE, actorUserId);
  }

  private async setStatus(
    organisationId: string,
    id: string,
    status: TerritoryStatus,
    actorUserId: string,
  ): Promise<Territory> {
    const updated = await this.territoryRepository.update(organisationId, id, {
      status,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Territory not found');
    }
    return updated;
  }

  private async assertParentExists(
    organisationId: string,
    parentTerritoryId: string,
  ): Promise<void> {
    const parent = await this.territoryRepository.findById(organisationId, parentTerritoryId);
    if (!parent) {
      throw new BadRequestException('Parent territory not found');
    }
  }

  /** Walks `parentTerritoryId` upward from the proposed new parent, rejecting if it ever
   *  reaches `territoryId` itself — that would make `territoryId` its own ancestor. A
   *  self-referential FK can't express "no cycles" declaratively, so this is
   *  service-enforced. */
  private async assertNoCycle(
    organisationId: string,
    territoryId: string,
    proposedParentId: string,
  ): Promise<void> {
    let currentId: string | null = proposedParentId;
    for (let depth = 0; depth < MAX_HIERARCHY_DEPTH && currentId; depth += 1) {
      if (currentId === territoryId) {
        throw new BadRequestException('Cannot re-parent a territory to one of its own descendants');
      }
      const current = await this.territoryRepository.findById(organisationId, currentId);
      currentId = current?.parentTerritoryId ?? null;
    }
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<Territory> {
    const territory = await this.territoryRepository.findById(organisationId, id);
    if (!territory) {
      throw new NotFoundException('Territory not found');
    }
    return territory;
  }

  /** `TER-000001`, `TER-000002`, ... — globally unique, same collision-avoidance loop as
   *  every other auto-numbered entity in this codebase. */
  private async generateUniqueCode(): Promise<string> {
    let sequence = 1;
    let candidate = formatTerritoryCode(sequence);
    while (await this.territoryRepository.existsByCode(candidate)) {
      sequence += 1;
      candidate = formatTerritoryCode(sequence);
    }
    return candidate;
  }
}

function formatTerritoryCode(sequence: number): string {
  return `${TERRITORY_CODE_PREFIX}-${String(sequence).padStart(TERRITORY_CODE_SEQUENCE_LENGTH, '0')}`;
}
