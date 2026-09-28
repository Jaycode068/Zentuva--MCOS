import { Injectable } from '@nestjs/common';
import { Consumer, ConsumerStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListConsumersParams {
  status?: ConsumerStatus;
  territoryId?: string;
  /** Case-insensitive substring match against name, code, or phone — same
   *  convention as `CustomerRepository.findManyByOrganisation`. */
  search?: string;
}

export interface CreateConsumerData {
  organisationId: string;
  consumerCode: string;
  fullName: string;
  phoneNumber: string;
  normalizedPhone: string;
  email?: string;
  territoryId?: string;
  address?: string;
  marketingOptIn?: boolean;
  createdById?: string;
  updatedById?: string;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Thin Prisma access for the `Consumer` aggregate (Sprint 32,
 * docs/domains/d2c.md). No business logic — see `ConsumerService`.
 *
 * Tenant-safety convention (matches every other repository in this
 * codebase): every method that reads or writes a specific consumer takes
 * `organisationId` and includes it in the query.
 */
@Injectable()
export class ConsumerRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<Consumer | null> {
    return this.prisma.consumer.findFirst({ where: { id, organisationId } });
  }

  findByNormalizedPhone(organisationId: string, normalizedPhone: string): Promise<Consumer | null> {
    return this.prisma.consumer.findFirst({ where: { organisationId, normalizedPhone } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListConsumersParams = {},
  ): Promise<Consumer[]> {
    return this.prisma.consumer.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.territoryId ? { territoryId: params.territoryId } : {}),
        ...(params.search
          ? {
              OR: [
                { fullName: { contains: params.search, mode: 'insensitive' } },
                { consumerCode: { contains: params.search, mode: 'insensitive' } },
                { phoneNumber: { contains: params.search, mode: 'insensitive' } },
                { normalizedPhone: { contains: params.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Globally unique (see `Consumer.consumerCode` schema comment) — checked
   *  without an `organisationId` filter, same convention as every other
   *  auto-numbered entity. */
  async existsByCode(consumerCode: string): Promise<boolean> {
    const count = await this.prisma.consumer.count({ where: { consumerCode } });
    return count > 0;
  }

  /** Idempotent find-or-create by `[organisationId, normalizedPhone]` — the
   *  exact `CandidateRepository.findOrCreate` recipe (Sprint 30): check,
   *  then create, and on a race (`P2002` — a concurrent request won first),
   *  re-fetch and return the winner rather than surfacing the constraint
   *  violation. A repeated/concurrent registration request for the same
   *  phone converges on exactly one `Consumer` row, never a duplicate
   *  (docs/domains/d2c.md §8 "Idempotent Registration"). */
  async findOrCreate(data: CreateConsumerData): Promise<{ consumer: Consumer; created: boolean }> {
    const existing = await this.findByNormalizedPhone(data.organisationId, data.normalizedPhone);
    if (existing) {
      return { consumer: existing, created: false };
    }
    try {
      const consumer = await this.prisma.consumer.create({
        data: {
          organisationId: data.organisationId,
          consumerCode: data.consumerCode,
          fullName: data.fullName,
          phoneNumber: data.phoneNumber,
          normalizedPhone: data.normalizedPhone,
          email: data.email,
          territoryId: data.territoryId,
          address: data.address,
          marketingOptIn: data.marketingOptIn,
          createdById: data.createdById,
          updatedById: data.updatedById,
        },
      });
      return { consumer, created: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        const raced = await this.findByNormalizedPhone(data.organisationId, data.normalizedPhone);
        if (raced) {
          return { consumer: raced, created: false };
        }
      }
      throw error;
    }
  }

  async update(
    organisationId: string,
    id: string,
    data: Prisma.ConsumerUncheckedUpdateInput,
  ): Promise<Consumer | null> {
    const result = await this.prisma.consumer.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.consumer.findUniqueOrThrow({ where: { id } });
  }
}
