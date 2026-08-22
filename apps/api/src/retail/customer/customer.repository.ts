import { Injectable } from '@nestjs/common';
import { Customer, CustomerStatus, CustomerType, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListCustomersParams {
  status?: CustomerStatus;
  customerType?: CustomerType;
  territoryId?: string;
  /** Simple case-insensitive substring match against name, code, or phone — same
   *  convention as `ProductRepository.findManyByOrganisation`. */
  search?: string;
}

/**
 * Thin Prisma access for the `Customer` aggregate (Sprint 4.8, docs/domains/customers.md).
 * No business logic — see `CustomerService`.
 *
 * Tenant-safety convention (matches every other repository in this codebase): every
 * method that reads or writes a specific customer takes `organisationId` and includes it
 * in the query.
 */
@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.CustomerCreateInput): Promise<Customer> {
    return this.prisma.customer.create({ data });
  }

  findById(organisationId: string, id: string): Promise<Customer | null> {
    return this.prisma.customer.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListCustomersParams = {},
  ): Promise<Customer[]> {
    return this.prisma.customer.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.customerType ? { customerType: params.customerType } : {}),
        ...(params.territoryId ? { territoryId: params.territoryId } : {}),
        ...(params.search
          ? {
              OR: [
                { customerName: { contains: params.search, mode: 'insensitive' } },
                { customerCode: { contains: params.search, mode: 'insensitive' } },
                { phoneNumber: { contains: params.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Globally unique (see `Customer.customerCode` schema comment) — checked without an
   *  `organisationId` filter, same convention as every other auto-numbered entity. */
  async existsByCode(customerCode: string): Promise<boolean> {
    const count = await this.prisma.customer.count({ where: { customerCode } });
    return count > 0;
  }

  async update(
    organisationId: string,
    id: string,
    data: Prisma.CustomerUpdateInput,
  ): Promise<Customer | null> {
    const result = await this.prisma.customer.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.customer.findUniqueOrThrow({ where: { id } });
  }
}
