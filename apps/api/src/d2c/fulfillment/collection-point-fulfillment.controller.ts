import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AssignCollectionPointInput, assignCollectionPointSchema } from '@zentuva/validation';

import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CollectionPointFulfillmentService } from './collection-point-fulfillment.service';
import {
  AlreadyAssignedError,
  CollectionPointNotEligibleError,
  InvalidFulfillmentTransitionError,
  NoEligibleCollectionPointError,
  NotAuthorizedForCollectionPointError,
} from './collection-point-fulfillment.types';

/**
 * Sprint 37 — Collection Point Fulfillment HTTP surface (docs/domains/d2c.md). A NEW,
 * dedicated permission pair (`d2c.collection_point.view`/`.fulfil`) gates every route —
 * `sales.customer.*` was deliberately NOT reused here (operating an assigned fulfilment
 * queue is a materially different, non-admin capability from Outlet/Customer CRUD, and
 * per Sprint 36's own precedent a Collection Point's responsible user needs no other
 * permission to be assigned; granted to Member at seed time for exactly that reason).
 * The actual "only YOUR assigned Collection Point" restriction is enforced inside
 * `CollectionPointFulfillmentService` as a resource-ownership check, not by this
 * permission's scope.
 */
@Controller('d2c/collection-point-fulfillments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CollectionPointFulfillmentController {
  constructor(private readonly service: CollectionPointFulfillmentService) {}

  @Post('assign')
  @RequirePermission('d2c.collection_point.fulfil')
  async assign(
    @Body(new ZodValidationPipe(assignCollectionPointSchema)) body: AssignCollectionPointInput,
    @CurrentUser() user: TokenPayload,
  ) {
    try {
      return await this.service.assignManually(
        user.organisationId,
        body.salesOrderId,
        body.outletId,
        user.sub,
      );
    } catch (error) {
      throw toHttpException(error);
    }
  }

  /** Declared before `:id`/`outlet/:outletId` — route order matters (never swallowed by
   *  a param route). The Field screen's own entry point. */
  @Get('my-outlets')
  @RequirePermission('d2c.collection_point.view')
  async getMyOutlets(@CurrentUser() user: TokenPayload) {
    const items = await this.service.getMyOutlets(user.organisationId, user.sub);
    return { items };
  }

  @Get('outlet/:outletId')
  @RequirePermission('d2c.collection_point.view')
  async getQueue(@Param('outletId') outletId: string, @CurrentUser() user: TokenPayload) {
    try {
      const items = await this.service.getQueueForOutlet(user.organisationId, outletId, user.sub);
      return { items };
    } catch (error) {
      throw toHttpException(error);
    }
  }

  /** Sprint 38 — the Field Collection Point inventory view (brief §10). Declared before
   *  `:id`/`outlet/:outletId` would never actually collide here (an extra path segment),
   *  but kept alongside its sibling `outlet/:outletId` route for readability. */
  @Get('outlet/:outletId/inventory')
  @RequirePermission('d2c.collection_point.view')
  async getInventoryView(@Param('outletId') outletId: string, @CurrentUser() user: TokenPayload) {
    try {
      const items = await this.service.getInventoryViewForOutlet(
        user.organisationId,
        outletId,
        user.sub,
      );
      return { items };
    } catch (error) {
      throw toHttpException(error);
    }
  }

  @Get(':id')
  @RequirePermission('d2c.collection_point.view')
  async getOne(@Param('id') id: string, @CurrentUser() user: TokenPayload) {
    try {
      return await this.service.getById(user.organisationId, id, user.sub);
    } catch (error) {
      throw toHttpException(error);
    }
  }

  @Post(':id/start-preparing')
  @RequirePermission('d2c.collection_point.fulfil')
  async startPreparing(@Param('id') id: string, @CurrentUser() user: TokenPayload) {
    try {
      return await this.service.startPreparing(user.organisationId, id, user.sub);
    } catch (error) {
      throw toHttpException(error);
    }
  }

  @Post(':id/ready-for-collection')
  @RequirePermission('d2c.collection_point.fulfil')
  async markReady(@Param('id') id: string, @CurrentUser() user: TokenPayload) {
    try {
      return await this.service.markReadyForCollection(user.organisationId, id, user.sub);
    } catch (error) {
      throw toHttpException(error);
    }
  }

  @Post(':id/confirm-collection')
  @RequirePermission('d2c.collection_point.fulfil')
  async confirmCollection(@Param('id') id: string, @CurrentUser() user: TokenPayload) {
    try {
      return await this.service.confirmCollection(user.organisationId, id, user.sub);
    } catch (error) {
      throw toHttpException(error);
    }
  }
}

/** Maps the service's typed domain errors onto the correct HTTP status — kept in one
 *  place rather than repeated per route. */
function toHttpException(error: unknown): Error {
  if (error instanceof NotAuthorizedForCollectionPointError) {
    return new ForbiddenException(error.message);
  }
  if (
    error instanceof NoEligibleCollectionPointError ||
    error instanceof CollectionPointNotEligibleError ||
    error instanceof AlreadyAssignedError ||
    error instanceof InvalidFulfillmentTransitionError
  ) {
    return new BadRequestException(error.message);
  }
  if (error instanceof Error) {
    return error;
  }
  return new BadRequestException('Unexpected error');
}
