import { Injectable } from '@nestjs/common';
import { Invitation, InvitationStatus, Prisma } from '@prisma/client';
import { AppError } from '@zentuva/utils';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Thin Prisma access for the Invitation aggregate. No business logic (token generation,
 * email sending, acceptance) — see InvitationService and docs/domains/identity.md §4/§5/§9.
 */
@Injectable()
export class InvitationRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.InvitationCreateInput): Promise<Invitation> {
    return this.prisma.invitation.create({ data });
  }

  findById(organisationId: string, id: string): Promise<Invitation | null> {
    return this.prisma.invitation.findFirst({ where: { id, organisationId } });
  }

  /** Global lookup by token hash — required pre-tenant-context, the invitee doesn't
   *  have a session yet (identity.md §5 Invitation Flow). */
  findByTokenHash(tokenHash: string): Promise<Invitation | null> {
    return this.prisma.invitation.findUnique({ where: { tokenHash } });
  }

  findManyByOrganisation(organisationId: string, status?: InvitationStatus): Promise<Invitation[]> {
    return this.prisma.invitation.findMany({
      where: { organisationId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  findPendingByEmail(organisationId: string, email: string): Promise<Invitation | null> {
    return this.prisma.invitation.findFirst({
      where: { organisationId, email, status: InvitationStatus.PENDING },
    });
  }

  async updateStatus(
    organisationId: string,
    id: string,
    status: InvitationStatus,
    extra: Prisma.InvitationUpdateInput = {},
  ): Promise<Invitation> {
    const result = await this.prisma.invitation.updateMany({
      where: { id, organisationId },
      data: { status, ...extra },
    });
    if (result.count === 0) {
      throw new AppError(
        `Invitation ${id} not found in organisation ${organisationId}`,
        404,
        'INVITATION_NOT_FOUND',
      );
    }
    return this.prisma.invitation.findUniqueOrThrow({ where: { id } });
  }
}
