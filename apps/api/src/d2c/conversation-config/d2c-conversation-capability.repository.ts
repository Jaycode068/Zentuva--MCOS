import { Injectable } from '@nestjs/common';
import { D2CConversationCapability, D2CConversationCapabilityConfig } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Thin Prisma access for `D2CConversationCapabilityConfig` (Sprint 44,
 * docs/domains/d2c.md "Tenant Conversation Configuration"). No business logic/
 * validation — see `D2CConversationConfigService`.
 */
@Injectable()
export class D2CConversationCapabilityRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByOrganisation(organisationId: string): Promise<D2CConversationCapabilityConfig[]> {
    return this.prisma.d2CConversationCapabilityConfig.findMany({ where: { organisationId } });
  }

  /** Upsert-by-capability — the admin save path always supplies the FULL desired set for
   *  every capability it touches (never a partial patch of one field), so a plain
   *  `upsert` per row is sufficient; no concurrent-partial-write race to protect against
   *  beyond Postgres's own per-statement atomicity (the whole save happens inside one
   *  `$transaction`, see the service). */
  upsert(
    organisationId: string,
    capability: D2CConversationCapability,
    data: { enabled: boolean; displayLabel: string | null; sortOrder: number },
  ): Promise<D2CConversationCapabilityConfig> {
    return this.prisma.d2CConversationCapabilityConfig.upsert({
      where: { organisationId_capability: { organisationId, capability } },
      create: { organisationId, capability, ...data },
      update: data,
    });
  }
}
