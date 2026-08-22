import { Module } from '@nestjs/common';

import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { TerritoryController } from './territory.controller';
import { TerritoryRepository } from './territory.repository';
import { TerritoryService } from './territory.service';

/**
 * Territory HTTP surface (Sprint 4.8, docs/domains/territories.md). Exports
 * `TerritoryRepository` so `CustomerModule`/`OutletModule` can inject it to validate a
 * customer's/outlet's optional `territoryId` belongs to the caller's own organisation —
 * same "import the module, inject its exported repository" pattern used everywhere else
 * in this codebase.
 */
@Module({
  imports: [IdentityModule, AuthModule],
  controllers: [TerritoryController],
  providers: [TerritoryRepository, TerritoryService],
  exports: [TerritoryRepository],
})
export class TerritoryModule {}
