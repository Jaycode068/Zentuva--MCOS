import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BankStatementImport, BankStatementTransaction } from '@prisma/client';
import { ImportBankStatementInput, importBankStatementSchema } from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CASH_BANK_AUDIT_ACTIONS } from '../cash-bank-audit-actions';
import { BankStatementService } from './bank-statement.service';

/**
 * Bank Statement HTTP surface (Sprint 14, docs/domains/cash-management.md "Bank
 * Statement Import"). `GET` requires only authentication; import requires the Owner
 * or Administrator role. Only emits an audit event when `wasCreated === true` — a
 * replayed idempotent import must not double-record history.
 */
@Controller('finance/cash/bank-statements')
@UseGuards(JwtAuthGuard)
export class BankStatementController {
  constructor(
    private readonly bankStatementService: BankStatementService,
    private readonly auditService: AuditService,
  ) {}

  @Get('imports')
  async listImports(
    @CurrentUser() user: TokenPayload,
    @Query('cashAccountId') cashAccountId?: string,
  ) {
    const imports = await this.bankStatementService.listImports(user.organisationId, cashAccountId);
    return { items: imports.map(toBankStatementImportResponse) };
  }

  @Get('imports/:id')
  async getImport(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const bankStatementImport = await this.bankStatementService.getImportById(
      user.organisationId,
      id,
    );
    if (!bankStatementImport) {
      throw new NotFoundException('Bank statement import not found');
    }
    return toBankStatementImportResponse(bankStatementImport);
  }

  @Get('transactions')
  async listTransactions(
    @CurrentUser() user: TokenPayload,
    @Query('cashAccountId') cashAccountId?: string,
    @Query('matchStatus') matchStatus?: BankStatementTransaction['matchStatus'],
  ) {
    const transactions = await this.bankStatementService.list(user.organisationId, {
      cashAccountId,
      matchStatus,
    });
    return { items: transactions.map(toBankStatementTransactionResponse) };
  }

  @Post(':cashAccountId/import')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async import(
    @Param('cashAccountId') cashAccountId: string,
    @Body(new ZodValidationPipe(importBankStatementSchema)) body: ImportBankStatementInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    if (body.rows.length > 5000) {
      throw new BadRequestException('A single import is limited to 5000 rows');
    }

    const { bankStatementImport, wasCreated } = await this.bankStatementService.import(
      user.organisationId,
      cashAccountId,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: CASH_BANK_AUDIT_ACTIONS.BANK_STATEMENT_IMPORTED,
        entityType: 'BankStatementImport',
        entityId: bankStatementImport.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          cashAccountId,
          filename: bankStatementImport.filename,
          totalRows: bankStatementImport.totalRows,
          importedRows: bankStatementImport.importedRows,
          duplicateRows: bankStatementImport.duplicateRows,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toBankStatementImportResponse(bankStatementImport);
  }
}

export function toBankStatementImportResponse(bankStatementImport: BankStatementImport) {
  return {
    id: bankStatementImport.id,
    cashAccountId: bankStatementImport.cashAccountId,
    filename: bankStatementImport.filename,
    importedById: bankStatementImport.importedById,
    importedAt: bankStatementImport.importedAt,
    totalRows: bankStatementImport.totalRows,
    importedRows: bankStatementImport.importedRows,
    duplicateRows: bankStatementImport.duplicateRows,
    errorRows: bankStatementImport.errorRows,
  };
}

export function toBankStatementTransactionResponse(transaction: BankStatementTransaction) {
  return {
    id: transaction.id,
    cashAccountId: transaction.cashAccountId,
    importBatchId: transaction.importBatchId,
    transactionDate: transaction.transactionDate,
    valueDate: transaction.valueDate,
    description: transaction.description,
    reference: transaction.reference,
    debit: transaction.debit,
    credit: transaction.credit,
    amount: transaction.amount,
    balance: transaction.balance,
    externalReference: transaction.externalReference,
    importedAt: transaction.importedAt,
    matchStatus: transaction.matchStatus,
  };
}
