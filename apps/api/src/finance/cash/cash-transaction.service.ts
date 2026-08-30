import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateCashTransactionInput } from '@zentuva/validation';

import {
  MissingSystemAccountError,
  NoOpenPeriodError,
  UnbalancedPostingError,
} from '../accounting/journal-posting';
import {
  CashTransactionAlreadyVoidedError,
  CashTransactionRepository,
  CashTransactionWithRelations,
  CreateCashTransactionResult,
  InvalidCashAccountError,
  InvalidContraAccountError,
  ListCashTransactionsParams,
} from './cash-transaction.repository';

/**
 * Domain service for the `CashTransaction` aggregate (Sprint 14,
 * docs/domains/cash-management.md).
 */
@Injectable()
export class CashTransactionService {
  constructor(private readonly cashTransactionRepository: CashTransactionRepository) {}

  getById(organisationId: string, id: string): Promise<CashTransactionWithRelations> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(
    organisationId: string,
    params?: ListCashTransactionsParams,
  ): Promise<CashTransactionWithRelations[]> {
    return this.cashTransactionRepository.findManyByOrganisation(organisationId, params);
  }

  async create(
    organisationId: string,
    input: CreateCashTransactionInput,
    actorUserId: string,
  ): Promise<CreateCashTransactionResult> {
    try {
      return await this.cashTransactionRepository.create({
        organisationId,
        cashAccountId: input.cashAccountId,
        transactionType: input.transactionType,
        transactionDate: input.transactionDate,
        amount: input.amount,
        description: input.description,
        reference: input.reference,
        contraAccountId: input.contraAccountId,
        idempotencyKey: input.idempotencyKey,
        createdById: actorUserId,
      });
    } catch (error) {
      if (
        error instanceof InvalidCashAccountError ||
        error instanceof InvalidContraAccountError ||
        error instanceof MissingSystemAccountError ||
        error instanceof NoOpenPeriodError ||
        error instanceof UnbalancedPostingError
      ) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async void(organisationId: string, id: string): Promise<CashTransactionWithRelations> {
    try {
      const result = await this.cashTransactionRepository.void(organisationId, id);
      if (!result) {
        throw new NotFoundException('Cash transaction not found');
      }
      return result;
    } catch (error) {
      if (error instanceof CashTransactionAlreadyVoidedError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private async getByIdOrThrow(
    organisationId: string,
    id: string,
  ): Promise<CashTransactionWithRelations> {
    const transaction = await this.cashTransactionRepository.findById(organisationId, id);
    if (!transaction) {
      throw new NotFoundException('Cash transaction not found');
    }
    return transaction;
  }
}
