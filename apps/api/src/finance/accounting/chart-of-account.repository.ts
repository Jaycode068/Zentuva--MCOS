import { Injectable } from '@nestjs/common';
import { AccountType, ChartOfAccount, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListChartOfAccountsParams {
  type?: AccountType;
  isActive?: boolean;
  search?: string;
}

/**
 * Thin Prisma access for the `ChartOfAccount` aggregate (Sprint 7,
 * docs/domains/accounting.md). No business logic beyond simple lookups — duplicate-code
 * prevention, parent-hierarchy guards, and system-account protection all live in
 * `ChartOfAccountService`; this file only knows how to read/write rows.
 */
@Injectable()
export class ChartOfAccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.ChartOfAccountCreateInput): Promise<ChartOfAccount> {
    return this.prisma.chartOfAccount.create({ data });
  }

  findById(organisationId: string, id: string): Promise<ChartOfAccount | null> {
    return this.prisma.chartOfAccount.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListChartOfAccountsParams = {},
  ): Promise<ChartOfAccount[]> {
    return this.prisma.chartOfAccount.findMany({
      where: {
        organisationId,
        ...(params.type ? { type: params.type } : {}),
        ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
        ...(params.search
          ? {
              OR: [
                { code: { contains: params.search, mode: 'insensitive' } },
                { name: { contains: params.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { code: 'asc' },
    });
  }

  /** Tenant-scoped — `code` is per-organisation, not global (unlike `Invoice.invoiceCode`
   *  — every tenant maintains its own Chart of Accounts). */
  async existsByCode(organisationId: string, code: string): Promise<boolean> {
    const count = await this.prisma.chartOfAccount.count({ where: { organisationId, code } });
    return count > 0;
  }

  /** Resolves "the AR account for this organisation" (etc.) without ever hardcoding an
   *  id — see `SYSTEM_ACCOUNT_KEYS`. */
  findBySystemKey(organisationId: string, systemKey: string): Promise<ChartOfAccount | null> {
    return this.prisma.chartOfAccount.findFirst({ where: { organisationId, systemKey } });
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.ChartOfAccountUpdateInput,
  ): Promise<ChartOfAccount | null> {
    return this.updateMatching(organisationId, id, data);
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.ChartOfAccountUpdateInput,
  ): Promise<ChartOfAccount | null> {
    const result = await this.prisma.chartOfAccount.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.chartOfAccount.findUniqueOrThrow({ where: { id } });
  }
}
