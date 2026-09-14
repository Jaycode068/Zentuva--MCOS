import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { HrOrganisationStructureService } from './hr-organisation-structure.service';
import { HrOverviewService } from './hr-overview.service';
import { RequirePermission } from '../identity/auth/decorators/require-permission.decorator';
import { PermissionsGuard } from '../identity/auth/guards/permissions.guard';

@Controller('hr')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class HrOverviewController {
  constructor(
    private readonly hrOverviewService: HrOverviewService,
    private readonly organisationStructureService: HrOrganisationStructureService,
  ) {}

  @Get('overview')
  @RequirePermission('hr.organisation_structure.view')
  getOverview(@CurrentUser() user: TokenPayload) {
    return this.hrOverviewService.getOverview(user.organisationId);
  }

  @Get('organisation-structure')
  @RequirePermission('hr.organisation_structure.view')
  getOrganisationStructure(@CurrentUser() user: TokenPayload) {
    return this.organisationStructureService.getStructure(user.organisationId);
  }
}
