import { Injectable } from '@nestjs/common';
import { Prisma, Role, User, UserRole, UserStatus } from '@prisma/client';
import { AppError } from '@zentuva/utils';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListUsersParams {
  status?: UserStatus;
  skip?: number;
  take?: number;
}

export type UserWithRoles = User & { userRoles: (UserRole & { role: Role })[] };

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

  /** Same as {@link findManyByOrganisation}, plus each user's role assignments — added
   *  Sprint 2.2 (User Management) so the list/detail endpoints can display a `role` column
   *  without an N+1 query per user. */
  findManyWithRolesByOrganisation(organisationId: string): Promise<UserWithRoles[]> {
    return this.prisma.user.findMany({
      where: { organisationId },
      include: { userRoles: { include: { role: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  findByIdWithRoles(organisationId: string, id: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findFirst({
      where: { id, organisationId },
      include: { userRoles: { include: { role: true } } },
    });
  }

  /** Creates a User and assigns its single initial Role atomically (Sprint 2.2 User
   *  Management: direct creation with a chosen role, no invitation flow). */
  createWithRole(
    data: Prisma.UserCreateInput,
    organisationId: string,
    roleId: string,
  ): Promise<UserWithRoles> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data });
      await tx.userRole.create({ data: { organisationId, userId: user.id, roleId } });
      return tx.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { userRoles: { include: { role: true } } },
      });
    });
  }

  countByOrganisation(organisationId: string, status?: UserStatus): Promise<number> {
    return this.prisma.user.count({ where: { organisationId, ...(status ? { status } : {}) } });
  }

  async updateProfile(
    organisationId: string,
    id: string,
    data: Pick<
      Prisma.UserUpdateInput,
      'firstName' | 'lastName' | 'employeeCode' | 'phoneNumber' | 'avatarUrl' | 'avatarKey'
    >,
  ): Promise<User> {
    return this.updateScoped(organisationId, id, data);
  }

  async updateStatus(organisationId: string, id: string, status: UserStatus): Promise<User> {
    return this.updateScoped(organisationId, id, { status });
  }

  /**
   * Not tenant-scoped by an incoming organisationId — used post-password-hash by the auth
   * flow, which already holds a User row it trusts. Also stamps `passwordChangedAt` and
   * clears `mustChangePassword` (Sprint 3.3) — every caller of this method (change-password,
   * reset-password) represents the user successfully setting a new password, so both side
   * effects belong here rather than being repeated at each call site.
   */
  updatePasswordHash(id: string, passwordHash: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false },
    });
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
