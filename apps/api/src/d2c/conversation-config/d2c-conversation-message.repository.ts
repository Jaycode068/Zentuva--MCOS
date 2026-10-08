import { Injectable } from '@nestjs/common';
import { D2CConversationMessageConfig, D2CConversationMessageKey } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Thin Prisma access for `D2CConversationMessageConfig` (Sprint 44,
 * docs/domains/d2c.md "Tenant Conversation Configuration"). No business logic/
 * validation — see `D2CConversationConfigService`.
 */
@Injectable()
export class D2CConversationMessageRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByOrganisation(organisationId: string): Promise<D2CConversationMessageConfig[]> {
    return this.prisma.d2CConversationMessageConfig.findMany({ where: { organisationId } });
  }

  upsert(
    organisationId: string,
    messageKey: D2CConversationMessageKey,
    value: string,
  ): Promise<D2CConversationMessageConfig> {
    return this.prisma.d2CConversationMessageConfig.upsert({
      where: { organisationId_messageKey: { organisationId, messageKey } },
      create: { organisationId, messageKey, value },
      update: { value },
    });
  }

  /** Reset-to-default (brief §Phase 11 "a safe way to restore a field to default") — a
   *  plain delete; absence of a row already means "use the platform default"
   *  everywhere this is read, so there is nothing else to reset. */
  delete(organisationId: string, messageKey: D2CConversationMessageKey): Promise<void> {
    return this.prisma.d2CConversationMessageConfig
      .deleteMany({ where: { organisationId, messageKey } })
      .then(() => undefined);
  }
}
