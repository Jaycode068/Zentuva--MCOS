import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ChartOfAccount } from '@prisma/client';
import { CreateChartOfAccountInput, UpdateChartOfAccountInput } from '@zentuva/validation';

import { ChartOfAccountRepository, ListChartOfAccountsParams } from './chart-of-account.repository';

/** How many levels up `assertNoCycle` will walk before giving up — same safety valve as
 *  `TerritoryService.assertNoCycle`, not a real limit on legitimate account depth. */
const MAX_HIERARCHY_DEPTH = 50;

/**
 * Domain service for the `ChartOfAccount` aggregate (Sprint 7,
 * docs/domains/accounting.md) — each organisation's own tenant-defined chart, with a
 * self-referential parent/child hierarchy of arbitrary depth (mirrors
 * `TerritoryService`'s exact cycle-prevention shape).
 *
 * System accounts (`isSystemAccount`) are created only by seed data / future
 * provisioning — no endpoint here ever sets `isSystemAccount`/`systemKey`, and none
 * ever lets a system account be deactivated.
 */
@Injectable()
export class ChartOfAccountService {
  constructor(private readonly chartOfAccountRepository: ChartOfAccountRepository) {}

  getById(organisationId: string, id: string): Promise<ChartOfAccount> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListChartOfAccountsParams): Promise<ChartOfAccount[]> {
    return this.chartOfAccountRepository.findManyByOrganisation(organisationId, params);
  }

  async create(
    organisationId: string,
    input: CreateChartOfAccountInput,
    actorUserId: string,
  ): Promise<ChartOfAccount> {
    if (await this.chartOfAccountRepository.existsByCode(organisationId, input.code)) {
      throw new BadRequestException(`Account code "${input.code}" is already in use`);
    }
    if (input.parentId) {
      await this.assertParentExists(organisationId, input.parentId);
    }

    return this.chartOfAccountRepository.create({
      organisation: { connect: { id: organisationId } },
      code: input.code,
      name: input.name,
      type: input.type,
      description: input.description,
      createdById: actorUserId,
      updatedById: actorUserId,
      ...(input.parentId ? { parent: { connect: { id: input.parentId } } } : {}),
    });
  }

  /** `code`/`type`/`isSystemAccount`/`systemKey` are never accepted here — immutable
   *  after creation. Re-parenting is accepted, guarded against forming a cycle. */
  async update(
    organisationId: string,
    id: string,
    input: UpdateChartOfAccountInput,
    actorUserId: string,
  ): Promise<ChartOfAccount> {
    await this.getByIdOrThrow(organisationId, id);

    if (input.parentId !== undefined && input.parentId !== null) {
      if (input.parentId === id) {
        throw new BadRequestException('An account cannot be its own parent');
      }
      await this.assertParentExists(organisationId, input.parentId);
      await this.assertNoCycle(organisationId, id, input.parentId);
    }

    const updated = await this.chartOfAccountRepository.update(organisationId, id, {
      name: input.name,
      description: input.description,
      updatedById: actorUserId,
      ...(input.parentId !== undefined
        ? input.parentId === null
          ? { parent: { disconnect: true } }
          : { parent: { connect: { id: input.parentId } } }
        : {}),
    });
    if (!updated) {
      throw new NotFoundException('Account not found');
    }
    return updated;
  }

  async activate(organisationId: string, id: string, actorUserId: string): Promise<ChartOfAccount> {
    const account = await this.getByIdOrThrow(organisationId, id);
    if (account.isActive) {
      throw new BadRequestException('Account is already active');
    }
    return this.setActive(organisationId, id, true, actorUserId);
  }

  /** System accounts can never be deactivated via this endpoint — deactivating, say,
   *  the organisation's `AR` account would break every future invoice/payment posting.
   *  This is a blunt, unconditional rule (not a dynamic "would this break anything"
   *  check) — the simplest rule that satisfies the brief's "do not allow users to
   *  accidentally deactivate critical system accounts." */
  async deactivate(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<ChartOfAccount> {
    const account = await this.getByIdOrThrow(organisationId, id);
    if (account.isSystemAccount) {
      throw new BadRequestException('A system account cannot be deactivated');
    }
    if (!account.isActive) {
      throw new BadRequestException('Account is already inactive');
    }
    return this.setActive(organisationId, id, false, actorUserId);
  }

  private async setActive(
    organisationId: string,
    id: string,
    isActive: boolean,
    actorUserId: string,
  ): Promise<ChartOfAccount> {
    const updated = await this.chartOfAccountRepository.update(organisationId, id, {
      isActive,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Account not found');
    }
    return updated;
  }

  private async assertParentExists(organisationId: string, parentId: string): Promise<void> {
    const parent = await this.chartOfAccountRepository.findById(organisationId, parentId);
    if (!parent) {
      throw new BadRequestException('Parent account not found');
    }
  }

  /** Walks `parentId` upward from the proposed new parent, rejecting if it ever reaches
   *  `accountId` itself — mirrors `TerritoryService.assertNoCycle` exactly. */
  private async assertNoCycle(
    organisationId: string,
    accountId: string,
    proposedParentId: string,
  ): Promise<void> {
    let currentId: string | null = proposedParentId;
    for (let depth = 0; depth < MAX_HIERARCHY_DEPTH && currentId; depth += 1) {
      if (currentId === accountId) {
        throw new BadRequestException('Cannot re-parent an account to one of its own descendants');
      }
      const current = await this.chartOfAccountRepository.findById(organisationId, currentId);
      currentId = current?.parentId ?? null;
    }
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<ChartOfAccount> {
    const account = await this.chartOfAccountRepository.findById(organisationId, id);
    if (!account) {
      throw new NotFoundException('Account not found');
    }
    return account;
  }
}
