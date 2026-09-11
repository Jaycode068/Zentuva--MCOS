/**
 * The Field Technician Maintenance surface (Sprint 22, docs/domains/
 * maintenance-integration.md "Field Technician Experience") reuses the
 * exact same Maintenance API every Admin Work Order screen already calls
 * — no separate mobile endpoint. Deliberately its own route group and its
 * own api/labels module, not re-exported through `(field)/field/api.ts` —
 * a Field Sales agent and a Maintenance technician are different people
 * doing unrelated jobs, and once a real Technician role exists it must
 * not inherit Field Sales' Customer/Order/Delivery access, nor should a
 * Field Sales agent see Maintenance data.
 */
export * from '@/app/(app)/settings/maintenance/api';
export { listProducts } from '@/app/(app)/settings/products/api';
export { listInventoryLocations } from '@/app/(app)/settings/inventory/api';
export { getAsset, recordAssetMeterReading } from '@/app/(app)/settings/assets/api';
