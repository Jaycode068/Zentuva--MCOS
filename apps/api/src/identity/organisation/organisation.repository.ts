import { Injectable } from '@nestjs/common';
import { Organisation, OrganisationStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Thin Prisma access for the Organisation aggregate. No business logic — see
 * OrganisationService and docs/domains/identity.md §4/§9.
 */
@Injectable()
export class OrganisationRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.OrganisationCreateInput): Promise<Organisation> {
    return this.prisma.organisation.create({ data });
  }

  findById(id: string): Promise<Organisation | null> {
    return this.prisma.organisation.findUnique({ where: { id } });
  }

  findBySlug(slug: string): Promise<Organisation | null> {
    return this.prisma.organisation.findUnique({ where: { slug } });
  }

  findByOrganisationCode(organisationCode: string): Promise<Organisation | null> {
    return this.prisma.organisation.findUnique({ where: { organisationCode } });
  }

  async existsBySlug(slug: string): Promise<boolean> {
    const count = await this.prisma.organisation.count({ where: { slug } });
    return count > 0;
  }

  async existsByOrganisationCode(organisationCode: string): Promise<boolean> {
    const count = await this.prisma.organisation.count({ where: { organisationCode } });
    return count > 0;
  }

  updateProfile(id: string, data: Prisma.OrganisationUpdateInput): Promise<Organisation> {
    return this.prisma.organisation.update({ where: { id }, data });
  }

  updateStatus(id: string, status: OrganisationStatus): Promise<Organisation> {
    return this.prisma.organisation.update({ where: { id }, data: { status } });
  }
}
