import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Customer, CustomerStatus } from '@prisma/client';
import { CreateCustomerInput, UpdateCustomerInput } from '@zentuva/validation';

import { TerritoryRepository } from '../territory/territory.repository';
import { CustomerRepository, ListCustomersParams } from './customer.repository';

const CUSTOMER_CODE_PREFIX = 'CUS';
const CUSTOMER_CODE_SEQUENCE_LENGTH = 6;

/**
 * Domain service for the `Customer` aggregate (Sprint 4.8, docs/domains/customers.md) —
 * the commercial account. Only `customerType`/`customerName`/`phoneNumber` are ever
 * required (enforced by `createCustomerSchema`); `territoryId` is validated here only
 * when supplied, exactly the "second line of defense behind the frontend's filtered
 * picker" pattern `ProductVariantService.assertFamilyExists` established.
 *
 * There is deliberately no `distributorId`/network-relationship concept anywhere in this
 * file — a customer's ability to be created or to place a Sales Order never depends on
 * anything in `retail/network/`.
 */
@Injectable()
export class CustomerService {
  constructor(
    private readonly customerRepository: CustomerRepository,
    private readonly territoryRepository: TerritoryRepository,
  ) {}

  getById(organisationId: string, id: string): Promise<Customer | null> {
    return this.customerRepository.findById(organisationId, id);
  }

  list(organisationId: string, params?: ListCustomersParams): Promise<Customer[]> {
    return this.customerRepository.findManyByOrganisation(organisationId, params);
  }

  /** New customers always start `ACTIVE`. */
  async create(
    organisationId: string,
    input: CreateCustomerInput,
    actorUserId: string,
  ): Promise<Customer> {
    if (input.territoryId) {
      await this.assertTerritoryExists(organisationId, input.territoryId);
    }
    const customerCode = await this.generateUniqueCode();

    return this.customerRepository.create({
      organisation: { connect: { id: organisationId } },
      customerCode,
      customerType: input.customerType,
      customerName: input.customerName,
      contactPersonName: input.contactPersonName,
      phoneNumber: input.phoneNumber,
      alternatePhoneNumber: input.alternatePhoneNumber,
      email: input.email,
      address: input.address,
      city: input.city,
      state: input.state,
      country: input.country,
      notes: input.notes,
      status: CustomerStatus.ACTIVE,
      createdById: actorUserId,
      updatedById: actorUserId,
      ...(input.territoryId ? { territory: { connect: { id: input.territoryId } } } : {}),
    });
  }

  /** Partial update — `customerCode` is never accepted here (immutable). `territoryId`
   *  may be set, changed, or cleared at any time (brief §12: "territory assigned later,
   *  changed later by authorised users"). */
  async update(
    organisationId: string,
    id: string,
    input: UpdateCustomerInput,
    actorUserId: string,
  ): Promise<Customer> {
    await this.getByIdOrThrow(organisationId, id);
    if (input.territoryId) {
      await this.assertTerritoryExists(organisationId, input.territoryId);
    }

    const updated = await this.customerRepository.update(organisationId, id, {
      customerType: input.customerType,
      customerName: input.customerName,
      phoneNumber: input.phoneNumber,
      contactPersonName: input.contactPersonName,
      alternatePhoneNumber: input.alternatePhoneNumber,
      email: input.email,
      address: input.address,
      city: input.city,
      state: input.state,
      country: input.country,
      notes: input.notes,
      updatedById: actorUserId,
      ...(input.territoryId !== undefined ? { territoryId: input.territoryId } : {}),
    });
    if (!updated) {
      throw new NotFoundException('Customer not found');
    }
    return updated;
  }

  async activate(organisationId: string, id: string, actorUserId: string): Promise<Customer> {
    const customer = await this.getByIdOrThrow(organisationId, id);
    if (customer.status === CustomerStatus.ACTIVE) {
      throw new BadRequestException('Customer is already active');
    }
    return this.setStatus(organisationId, id, CustomerStatus.ACTIVE, actorUserId);
  }

  async deactivate(organisationId: string, id: string, actorUserId: string): Promise<Customer> {
    const customer = await this.getByIdOrThrow(organisationId, id);
    if (customer.status === CustomerStatus.INACTIVE) {
      throw new BadRequestException('Customer is already inactive');
    }
    return this.setStatus(organisationId, id, CustomerStatus.INACTIVE, actorUserId);
  }

  private async setStatus(
    organisationId: string,
    id: string,
    status: CustomerStatus,
    actorUserId: string,
  ): Promise<Customer> {
    const updated = await this.customerRepository.update(organisationId, id, {
      status,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Customer not found');
    }
    return updated;
  }

  private async assertTerritoryExists(organisationId: string, territoryId: string): Promise<void> {
    const territory = await this.territoryRepository.findById(organisationId, territoryId);
    if (!territory) {
      throw new BadRequestException('Territory not found');
    }
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<Customer> {
    const customer = await this.customerRepository.findById(organisationId, id);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  /** `CUS-000001`, `CUS-000002`, ... — globally unique, same collision-avoidance loop as
   *  every other auto-numbered entity in this codebase. */
  private async generateUniqueCode(): Promise<string> {
    let sequence = 1;
    let candidate = formatCustomerCode(sequence);
    while (await this.customerRepository.existsByCode(candidate)) {
      sequence += 1;
      candidate = formatCustomerCode(sequence);
    }
    return candidate;
  }
}

function formatCustomerCode(sequence: number): string {
  return `${CUSTOMER_CODE_PREFIX}-${String(sequence).padStart(CUSTOMER_CODE_SEQUENCE_LENGTH, '0')}`;
}
