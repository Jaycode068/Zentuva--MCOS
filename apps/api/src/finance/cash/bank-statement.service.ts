import { BadRequestException, Injectable } from '@nestjs/common';
import { BankStatementTransaction } from '@prisma/client';
import { ImportBankStatementInput } from '@zentuva/validation';

import {
  BankStatementRepository,
  ImportBankStatementResult,
  InvalidCashAccountError,
  ListBankStatementTransactionsParams,
} from './bank-statement.repository';

/**
 * Domain service for `BankStatementImport`/`BankStatementTransaction` (Sprint 14,
 * docs/domains/cash-management.md "Bank Statement Import"). The CSV column-mapping
 * step happens client-side (`papaparse`, `apps/web/src/lib/...`) — this service
 * receives already-mapped, already-normalised rows and re-validates them
 * independently (via `importBankStatementSchema`, at the controller layer),
 * never trusting client-side validation alone.
 */
@Injectable()
export class BankStatementService {
  constructor(private readonly bankStatementRepository: BankStatementRepository) {}

  list(
    organisationId: string,
    params?: ListBankStatementTransactionsParams,
  ): Promise<BankStatementTransaction[]> {
    return this.bankStatementRepository.findManyTransactions(organisationId, params);
  }

  listImports(organisationId: string, cashAccountId?: string) {
    return this.bankStatementRepository.findManyImports(organisationId, cashAccountId);
  }

  getImportById(organisationId: string, id: string) {
    return this.bankStatementRepository.findImportById(organisationId, id);
  }

  async import(
    organisationId: string,
    cashAccountId: string,
    input: ImportBankStatementInput,
    actorUserId: string,
  ): Promise<ImportBankStatementResult> {
    try {
      return await this.bankStatementRepository.import({
        organisationId,
        cashAccountId,
        filename: input.filename,
        rows: input.rows,
        idempotencyKey: input.idempotencyKey,
        importedById: actorUserId,
      });
    } catch (error) {
      if (error instanceof InvalidCashAccountError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
