import type { BadgeProps } from '@zentuva/ui';

import type {
  CustomerStatus,
  CustomerType,
  DistributionRelationshipType,
  NetworkRelationshipStatus,
  OutletPhotoType,
  OutletStatus,
  OutletType,
  TerritoryStatus,
} from './api';

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  DISTRIBUTOR: 'Distributor',
  WHOLESALER: 'Wholesaler',
  RETAILER: 'Retailer',
  SUPERMARKET: 'Supermarket',
  CORPORATE: 'Corporate',
  INSTITUTION: 'Institution',
  RESTAURANT: 'Restaurant',
  HOTEL: 'Hotel',
  OTHER: 'Other',
};

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

export const CUSTOMER_STATUS_VARIANT: Record<CustomerStatus, NonNullable<BadgeProps['variant']>> = {
  ACTIVE: 'success',
  INACTIVE: 'default',
};

export const OUTLET_TYPE_LABELS: Record<OutletType, string> = {
  SUPERMARKET: 'Supermarket',
  HYPERMARKET: 'Hypermarket',
  WHOLESALE_STORE: 'Wholesale Store',
  RETAIL_SHOP: 'Retail Shop',
  KIOSK: 'Kiosk',
  MARKET_STALL: 'Market Stall',
  DISTRIBUTOR_WAREHOUSE: 'Distributor Warehouse',
  WHOLESALER_WAREHOUSE: 'Wholesaler Warehouse',
  CONVENIENCE_STORE: 'Convenience Store',
  RESTAURANT: 'Restaurant',
  HOTEL: 'Hotel',
  CORPORATE: 'Corporate',
  INSTITUTION: 'Institution',
  OTHER: 'Other',
};

export const OUTLET_STATUS_LABELS: Record<OutletStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

export const OUTLET_STATUS_VARIANT: Record<OutletStatus, NonNullable<BadgeProps['variant']>> = {
  ACTIVE: 'success',
  INACTIVE: 'default',
};

export const OUTLET_PHOTO_TYPE_LABELS: Record<OutletPhotoType, string> = {
  FRONT: 'Front',
  SIGNAGE: 'Signage',
  INTERIOR: 'Interior',
  SHELF_DISPLAY: 'Shelf Display',
  OTHER: 'Other',
};

export const TERRITORY_STATUS_LABELS: Record<TerritoryStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

export const TERRITORY_STATUS_VARIANT: Record<
  TerritoryStatus,
  NonNullable<BadgeProps['variant']>
> = {
  ACTIVE: 'success',
  INACTIVE: 'default',
};

export const RELATIONSHIP_TYPE_LABELS: Record<DistributionRelationshipType, string> = {
  DISTRIBUTES_TO: 'Distributes To',
  WHOLESALES_TO: 'Wholesales To',
  SUPPLIES: 'Supplies',
  OTHER: 'Other',
};

export const NETWORK_STATUS_LABELS: Record<NetworkRelationshipStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

export const NETWORK_STATUS_VARIANT: Record<
  NetworkRelationshipStatus,
  NonNullable<BadgeProps['variant']>
> = {
  ACTIVE: 'success',
  INACTIVE: 'default',
};
