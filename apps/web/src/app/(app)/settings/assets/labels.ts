import type { BadgeProps } from '@zentuva/ui';

import type {
  AssetAcquisitionType,
  AssetCategoryStatus,
  AssetCondition,
  AssetDocumentType,
  AssetLocationStatus,
  AssetMeterType,
  AssetStatus,
} from './api';

export const ASSET_CATEGORY_STATUS_LABELS: Record<AssetCategoryStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

export const ASSET_CATEGORY_STATUS_VARIANT: Record<
  AssetCategoryStatus,
  NonNullable<BadgeProps['variant']>
> = {
  ACTIVE: 'success',
  INACTIVE: 'default',
};

export const ASSET_LOCATION_STATUS_LABELS: Record<AssetLocationStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

export const ASSET_LOCATION_STATUS_VARIANT: Record<
  AssetLocationStatus,
  NonNullable<BadgeProps['variant']>
> = {
  ACTIVE: 'success',
  INACTIVE: 'default',
};

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  IN_SERVICE: 'In Service',
  UNDER_MAINTENANCE: 'Under Maintenance',
  OUT_OF_SERVICE: 'Out of Service',
  DISPOSED: 'Disposed',
  RETIRED: 'Retired',
};

export const ASSET_STATUS_VARIANT: Record<AssetStatus, NonNullable<BadgeProps['variant']>> = {
  DRAFT: 'default',
  ACTIVE: 'warning',
  IN_SERVICE: 'success',
  UNDER_MAINTENANCE: 'warning',
  OUT_OF_SERVICE: 'destructive',
  DISPOSED: 'destructive',
  RETIRED: 'default',
};

export const ASSET_CONDITION_LABELS: Record<AssetCondition, string> = {
  NEW: 'New',
  GOOD: 'Good',
  FAIR: 'Fair',
  POOR: 'Poor',
  CRITICAL: 'Critical',
};

export const ASSET_CONDITION_VARIANT: Record<AssetCondition, NonNullable<BadgeProps['variant']>> = {
  NEW: 'success',
  GOOD: 'success',
  FAIR: 'warning',
  POOR: 'destructive',
  CRITICAL: 'destructive',
};

export const ASSET_ACQUISITION_TYPE_LABELS: Record<AssetAcquisitionType, string> = {
  PURCHASE: 'Purchase',
  CAPITAL_PROJECT: 'Capital Project',
  TRANSFER: 'Transfer',
  DONATION: 'Donation',
  LEASE: 'Lease',
  OTHER: 'Other',
};

export const ASSET_DOCUMENT_TYPE_LABELS: Record<AssetDocumentType, string> = {
  PHOTO: 'Photo',
  INVOICE: 'Invoice',
  WARRANTY_DOCUMENT: 'Warranty Document',
  MANUAL: 'Manual',
  CERTIFICATE: 'Certificate',
  REGISTRATION: 'Registration',
  OTHER: 'Other',
};

export const ASSET_METER_TYPE_LABELS: Record<AssetMeterType, string> = {
  HOURS: 'Operating Hours',
  KILOMETERS: 'Kilometers',
  CYCLES: 'Cycles',
  UNITS: 'Units',
  OTHER: 'Other',
};

export const ASSET_TRANSITION_LABELS: Record<string, string> = {
  activate: 'Activate',
  commission: 'Commission',
  'start-maintenance': 'Start Maintenance',
  'resume-service': 'Resume Service',
  'take-out-of-service': 'Take Out of Service',
  'return-to-service': 'Return to Service',
  dispose: 'Dispose',
  retire: 'Retire',
};
