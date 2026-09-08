import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { UserService } from '../identity/user/user.service';
import { MaintenanceOverviewService } from './maintenance-overview.service';

/**
 * Maintenance Overview / Asset-History HTTP surface (Sprint 21, docs/
 * domains/maintenance.md). Any authenticated organisation member may
 * read — the same "reporting is not gated behind write RBAC" convention
 * every prior domain's own dashboard/reporting endpoints already use.
 */
@Controller('maintenance')
@UseGuards(JwtAuthGuard)
export class MaintenanceOverviewController {
  constructor(
    private readonly maintenanceOverviewService: MaintenanceOverviewService,
    private readonly userService: UserService,
  ) {}

  @Get('overview')
  getOverview(@CurrentUser() user: TokenPayload) {
    return this.maintenanceOverviewService.getOverview(user.organisationId);
  }

  /** Technician picker — the exact `AssetController.listCustodians()`
   *  precedent (Sprint 20): no separate "Technician" role/table exists,
   *  any organisation member can be assigned. */
  @Get('technicians')
  async listTechnicians(@CurrentUser() user: TokenPayload) {
    const items = await this.userService.listByOrganisation(user.organisationId);
    return {
      items: items.map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
      })),
    };
  }

  @Get('assets/:assetId/history')
  getAssetHistory(@CurrentUser() user: TokenPayload, @Param('assetId') assetId: string) {
    return this.maintenanceOverviewService.getAssetHistory(user.organisationId, assetId);
  }

  @Get('assets/:assetId/open-work')
  async getAssetOpenWork(@CurrentUser() user: TokenPayload, @Param('assetId') assetId: string) {
    const items = await this.maintenanceOverviewService.getAssetOpenWork(
      user.organisationId,
      assetId,
    );
    return { items };
  }
}
