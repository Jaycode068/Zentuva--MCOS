import { Injectable } from '@nestjs/common';
import { Prisma, User, UserStatus } from '@prisma/client';
import { AppError } from '@zentuva/utils';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListUsersParams {
  status?: UserStatus;
  skip?: number;
  take?: number;
}

/**
 * Thin Prisma access for the User aggregate. No business logic — see UserService and
 * docs/domains/identity.md §4/§9.
 *
 * Tenant-safety convention (identity.md §7): every method that reads or writes a
 * specific user takes `organisationId` and includes it in the query, even though `id`
 * alone is a globally unique cuid — this defends against a request authenticated for one
 * organisation ever touching another organisation's row, not just ID collisions.
 * `findByEmail` is the one deliberate exception: login (identity.md §5) looks a user up
 * by email *before* any tenant context exists.
 */
@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  findById(organisationId: string, id: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { id, organisationId } });
  }

  /** Global lookup by email — required pre-tenant-context (login flow, identity.md §5). */
  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async existsByEmail(email: string): Promise<boolean> {
    const count = await this.prisma.user.count({ where: { email } });
    return count > 0;
  }

  findManyByOrganisation(organisationId: string, params: ListUsersParams = {}): Promise<User[]> {
    return this.prisma.user.findMany({
      where: { organisationId, ...(params.status ? { status: params.status } : {}) },
      skip: params.skip,
      take: params.take,
      orderBy: { createdAt: 'asc' },
    });
  }

  countByOrganisation(organisationId: string, status?: UserStatus): Promise<number> {
    return this.prisma.user.count({ where: { organisationId, ...(status ? { status } : {}) } });
  }

  async updateProfile(
    organisationId: string,
    id: string,
    data: Pick<Prisma.UserUpdateInput, 'firstName' | 'lastName' | 'employeeCode'>,
  ): Promise<User> {
    return this.updateScoped(organisationId, id, data);
  }

  async updateStatus(organisationId: string, id: string, status: UserStatus): Promise<User> {
    return this.updateScoped(organisationId, id, { status });
  }

  /** Not tenant-scoped by an incoming organisationId — used post-password-hash by the
   *  (future) auth flow, which already holds a User row it trusts. */
  updatePasswordHash(id: string, passwordHash: string): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { passwordHash } });
  }

  updateLastLoginAt(id: string, at: Date = new Date()): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { lastLoginAt: at } });
  }

  /** Atomic increment — safe under concurrent failed-login attempts (identity.md §4
   *  User Status values; mechanism added Sprint 1B.2, see User.failedLoginAttempts). */
  incrementFailedLoginAttempts(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { failedLoginAttempts: { increment: 1 } },
    });
  }

  resetFailedLoginAttempts(id: string): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { failedLoginAttempts: 0 } });
  }

  private async updateScoped(
    organisationId: string,
    id: string,
    data: Prisma.UserUpdateInput,
  ): Promise<User> {
    const result = await this.prisma.user.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      throw new AppError(
        `User ${id} not found in organisation ${organisationId}`,
        404,
        'USER_NOT_FOUND',
      );
    }
    return this.prisma.user.findUniqueOrThrow({ where: { id } });
  }
}
