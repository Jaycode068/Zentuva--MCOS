import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Customer, CustomerStatus, CustomerType } from '@prisma/client';
import {
  CreateCustomerInput,
  UpdateCustomerInput,
  createCustomerSchema,
  updateCustomerSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CUSTOMER_AUDIT_ACTIONS } from './customer-audit-actions';
import { CustomerService } from './customer.service';

/**
 * Customer HTTP surface (Sprint 4.8, docs/domains/customers.md). `GET` requires only
 * authentication — Member has read-only access; every write additionally requires the
 * Owner or Administrator role (`RolesGuard`).
 *
 * Tenant isolation: every method resolves the target customer by `(id, organisationId)`
 * together, same convention as every other domain controller.
 */
@Controller('retail/customers')
@UseGuards(JwtAuthGuard)
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: CustomerStatus,
    @Query('customerType') customerType?: CustomerType,
    @Query('territoryId') territoryId?: string,
    @Query('search') search?: string,
  ) {
    const customers = await this.customerService.list(user.organisationId, {
      status,
      customerType,
      territoryId,
      search: search?.trim() || undefined,
    });
    return { items: customers.map(toCustomerResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const customer = await this.customerService.getById(user.organisationId, id);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return toCustomerResponse(customer);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createCustomerSchema)) body: CreateCustomerInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const created = await this.customerService.create(user.organisationId, body, user.sub);

    await this.auditService.record({
      action: CUSTOMER_AUDIT_ACTIONS.CREATED,
      entityType: 'Customer',
      entityId: created.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: {
        customerCode: created.customerCode,
        customerName: created.customerName,
        customerType: created.customerType,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCustomerResponse(created);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCustomerSchema)) body: UpdateCustomerInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.customerService.update(user.organisationId, id, body, user.sub);

    await this.auditService.record({
      action: CUSTOMER_AUDIT_ACTIONS.UPDATED,
      entityType: 'Customer',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { fields: Object.keys(body) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCustomerResponse(updated);
  }

  @Post(':id/activate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async activate(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.customerService.activate(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: CUSTOMER_AUDIT_ACTIONS.ACTIVATED,
      entityType: 'Customer',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCustomerResponse(updated);
  }

  @Post(':id/deactivate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.customerService.deactivate(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: CUSTOMER_AUDIT_ACTIONS.DEACTIVATED,
      entityType: 'Customer',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCustomerResponse(updated);
  }
}

function toCustomerResponse(customer: Customer) {
  return {
    id: customer.id,
    customerCode: customer.customerCode,
    customerType: customer.customerType,
    customerName: customer.customerName,
    contactPersonName: customer.contactPersonName,
    phoneNumber: customer.phoneNumber,
    alternatePhoneNumber: customer.alternatePhoneNumber,
    email: customer.email,
    address: customer.address,
    city: customer.city,
    state: customer.state,
    country: customer.country,
    territoryId: customer.territoryId,
    status: customer.status,
    notes: customer.notes,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}
