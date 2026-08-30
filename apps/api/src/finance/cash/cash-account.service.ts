import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CashAccount } from '@prisma/client';
import { CreateCashAccountInput, UpdateCashAccountInput } from '@zentuva/validation';

import { NoOpenPeriodError, UnbalancedPostingError } from '../accounting/journal-posting';
import {
  CashAccountRepository,
  CreateCashAccountResult,
  DuplicateCashAccountCodeError,
  ListCashAccountsParams,
  MissingSystemAccountError,
} from './cash-account.repository';

/**
 * Domain service for the `CashAccount` aggregate (Sprint 14,
 * docs/domains/cash-management.md). Never exposes a full `accountNumber` from
 * `list()`/`getById()` — see `cash-account.controller.ts`'s `toCashAccountResponse`
 * for masking; `getAccountNumber()` here is the one path that returns the real
 * value, reserved for the Owner/Administrator-only reveal endpoint.
 */
@Injectable()
export class CashAccountService {
  constructor(private readonly cashAccountRepository: CashAccountRepository) {}

  getById(organisationId: string, id: string): Promise<CashAccount> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListCashAccountsParams): Promise<CashAccount[]> {
    return this.cashAccountRepository.findManyByOrganisation(organisationId, params);
  }

  async getAccountNumber(organisationId: string, id: string): Promise<string | null> {
    const account = await this.getByIdOrThrow(organisationId, id);
    return account.accountNumber;
  }

  async create(
    organisationId: string,
    input: CreateCashAccountInput,
    actorUserId: string,
  ): Promise<CreateCashAccountResult> {
    try {
      return await this.cashAccountRepository.create({
        organisationId,
        accountCode: input.accountCode,
        name: input.name,
        accountType: input.accountType,
        currency: input.currency,
        bankName: input.bankName,
        accountNumber: input.accountNumber,
        accountName: input.accountName,
        description: input.description,
        openingBalance: input.openingBalance,
        openingBalanceDate: input.openingBalanceDate,
        idempotencyKey: input.idempotencyKey,
        createdById: actorUserId,
      });
    } catch (error) {
      if (
        error instanceof DuplicateCashAccountCodeError ||
        error instanceof MissingSystemAccountError ||
        error instanceof NoOpenPeriodError ||
        error instanceof UnbalancedPostingError
      ) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async update(
    organisationId: string,
    id: string,
    input: UpdateCashAccountInput,
    actorUserId: string,
  ): Promise<CashAccount> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.cashAccountRepository.update(organisationId, id, {
      name: input.name,
      bankName: input.bankName,
      accountNumber: input.accountNumber,
      accountName: input.accountName,
      description: input.description,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Cash account not found');
    }
    return updated;
  }

  async deactivate(organisationId: string, id: string, actorUserId: string): Promise<CashAccount> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.cashAccountRepository.deactivate(organisationId, id, actorUserId);
    if (!updated) {
      throw new NotFoundException('Cash account not found');
    }
    return updated;
  }

  async activate(organisationId: string, id: string, actorUserId: string): Promise<CashAccount> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.cashAccountRepository.activate(organisationId, id, actorUserId);
    if (!updated) {
      throw new NotFoundException('Cash account not found');
    }
    return updated;
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<CashAccount> {
    const account = await this.cashAccountRepository.findById(organisationId, id);
    if (!account) {
      throw new NotFoundException('Cash account not found');
    }
    return account;
  }
}
