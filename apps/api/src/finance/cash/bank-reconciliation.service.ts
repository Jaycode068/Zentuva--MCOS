import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BankReconciliation, ReconciliationMatchType } from '@prisma/client';
import { CreateBankReconciliationInput, MatchReconciliationInput } from '@zentuva/validation';

import { CashAccountRepository } from './cash-account.repository';
import {
  CreateBankReconciliationResult,
  InvalidCashAccountError,
  InvalidMatchTargetError,
  ReconciliationAlreadyInProgressError,
  ReconciliationIncompleteError,
  ReconciliationMatchWithRelations,
  ReconciliationNotFoundError,
  ReconciliationNotInProgressError,
  UnmatchedBookLine,
  BankReconciliationRepository,
} from './bank-reconciliation.repository';
import { LedgerService } from '../accounting/ledger.service';

export interface ReconciliationDetail {
  reconciliation: BankReconciliation;
  matches: ReconciliationMatchWithRelations[];
  unmatchedBank: Awaited<ReturnType<BankReconciliationRepository['findUnmatchedBankTransactions']>>;
  unmatchedBook: UnmatchedBookLine[];
  /** Live from `LedgerService.getAccountActivity` — never stored. */
  bookBalance: number;
  /** `bookBalance - reconciliation.closingBankBalance`. */
  difference: number;
}

/**
 * Domain service for `BankReconciliation`/`ReconciliationMatch` (Sprint 14,
 * docs/domains/cash-management.md "Reconciliation") — the core feature of this
 * sprint. `getDetail()` composes the repository's matched/unmatched queries with
 * `LedgerService.getAccountActivity` for the live Book Balance figure — never a
 * second, independently-maintained balance.
 */
@Injectable()
export class BankReconciliationService {
  constructor(
    private readonly bankReconciliationRepository: BankReconciliationRepository,
    private readonly cashAccountRepository: CashAccountRepository,
    private readonly ledgerService: LedgerService,
  ) {}

  list(organisationId: string, cashAccountId?: string): Promise<BankReconciliation[]> {
    return this.bankReconciliationRepository.findManyByOrganisation(organisationId, cashAccountId);
  }

  async getDetail(organisationId: string, id: string): Promise<ReconciliationDetail> {
    const reconciliation = await this.getByIdOrThrow(organisationId, id);
    const cashAccount = await this.cashAccountRepository.findById(
      organisationId,
      reconciliation.cashAccountId,
    );
    if (!cashAccount) {
      throw new NotFoundException('Cash account not found');
    }

    const [matches, unmatchedBank, unmatchedBook, activity] = await Promise.all([
      this.bankReconciliationRepository.findMatches(id),
      this.bankReconciliationRepository.findUnmatchedBankTransactions(
        organisationId,
        reconciliation.cashAccountId,
        reconciliation.periodStart,
        reconciliation.periodEnd,
      ),
      this.bankReconciliationRepository.findUnmatchedBookLines(
        organisationId,
        cashAccount.linkedChartOfAccountId,
        reconciliation.periodStart,
        reconciliation.periodEnd,
      ),
      this.ledgerService.getAccountActivity(organisationId, cashAccount.linkedChartOfAccountId, {
        to: new Date(),
      }),
    ]);

    return {
      reconciliation,
      matches,
      unmatchedBank,
      unmatchedBook,
      bookBalance: activity.closingBalance,
      difference: roundCurrency(activity.closingBalance - reconciliation.closingBankBalance),
    };
  }

  async create(
    organisationId: string,
    input: CreateBankReconciliationInput,
    actorUserId: string,
  ): Promise<CreateBankReconciliationResult> {
    try {
      return await this.bankReconciliationRepository.create({
        organisationId,
        cashAccountId: input.cashAccountId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        openingBankBalance: input.openingBankBalance,
        closingBankBalance: input.closingBankBalance,
        idempotencyKey: input.idempotencyKey,
        createdById: actorUserId,
      });
    } catch (error) {
      if (error instanceof InvalidCashAccountError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof ReconciliationAlreadyInProgressError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  async match(
    organisationId: string,
    bankReconciliationId: string,
    input: MatchReconciliationInput,
    actorUserId: string,
  ) {
    try {
      return await this.bankReconciliationRepository.match({
        organisationId,
        bankReconciliationId,
        bankStatementTransactionId: input.bankStatementTransactionId,
        journalEntryLineId: input.journalEntryLineId,
        matchType: ReconciliationMatchType.MANUAL,
        matchedById: actorUserId,
      });
    } catch (error) {
      throw this.translateReconciliationError(error);
    }
  }

  async unmatch(
    organisationId: string,
    bankReconciliationId: string,
    matchId: string,
  ): Promise<void> {
    try {
      await this.bankReconciliationRepository.unmatch(
        organisationId,
        bankReconciliationId,
        matchId,
      );
    } catch (error) {
      throw this.translateReconciliationError(error);
    }
  }

  async autoMatch(organisationId: string, id: string, actorUserId: string) {
    try {
      return await this.bankReconciliationRepository.autoMatch(organisationId, id, actorUserId);
    } catch (error) {
      throw this.translateReconciliationError(error);
    }
  }

  async complete(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<BankReconciliation> {
    try {
      return await this.bankReconciliationRepository.complete(organisationId, id, actorUserId);
    } catch (error) {
      if (error instanceof ReconciliationIncompleteError) {
        throw new ConflictException({
          message: error.message,
          unmatchedBankCount: error.unmatchedBankCount,
          unmatchedBookCount: error.unmatchedBookCount,
        });
      }
      throw this.translateReconciliationError(error);
    }
  }

  private translateReconciliationError(error: unknown): unknown {
    if (error instanceof ReconciliationNotFoundError) {
      return new NotFoundException(error.message);
    }
    if (error instanceof ReconciliationNotInProgressError) {
      return new ConflictException(error.message);
    }
    if (error instanceof InvalidMatchTargetError) {
      return new BadRequestException(error.message);
    }
    return error;
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<BankReconciliation> {
    const reconciliation = await this.bankReconciliationRepository.findById(organisationId, id);
    if (!reconciliation) {
      throw new NotFoundException('Reconciliation not found');
    }
    return reconciliation;
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
