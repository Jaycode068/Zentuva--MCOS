import { Injectable } from '@nestjs/common';
import { D2CConversationProfile } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Thin Prisma access for `D2CConversationProfile` (Sprint 44,
 * docs/domains/d2c.md "Tenant Conversation Configuration"). No business logic — see
 * `D2CConversationConfigService`.
 */
@Injectable()
export class D2CConversationProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByOrganisation(organisationId: string): Promise<D2CConversationProfile | null> {
    return this.prisma.d2CConversationProfile.findUnique({ where: { organisationId } });
  }

  upsert(
    organisationId: string,
    data: { supportPhoneOverride: string | null; supportEmailOverride: string | null },
  ): Promise<D2CConversationProfile> {
    return this.prisma.d2CConversationProfile.upsert({
      where: { organisationId },
      create: { organisationId, ...data },
      update: data,
    });
  }
}
