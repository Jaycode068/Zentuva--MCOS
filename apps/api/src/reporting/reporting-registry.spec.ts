import { readFileSync } from 'fs';
import { join } from 'path';

import { PERMISSION_CATALOGUE } from '../identity/authorization/permission-catalogue';
import { METRIC_REGISTRY } from './reporting-metric-registry';
import { REPORT_REGISTRY } from './reporting-report-registry';

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation (brief §5B/§5C "typed and
 * discoverable, not an unstructured collection of strings"). Structural sanity checks
 * over the two registries — this is exactly the kind of bug a plain array of object
 * literals can silently contain (a permission key that was never added to the real
 * catalogue, a drill-down pointing at a report id that doesn't exist, a duplicate
 * id) without any compiler error, since every field here is a plain string.
 */
describe('Metric Registry', () => {
  const permissionKeys = new Set(PERMISSION_CATALOGUE.map((entry) => entry.key));

  it('every metric id is unique', () => {
    const ids = METRIC_REGISTRY.map((metric) => metric.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every metric's requiredPermission is a real, existing catalogue entry", () => {
    for (const metric of METRIC_REGISTRY) {
      expect(permissionKeys.has(metric.requiredPermission)).toBe(true);
    }
  });

  it('every metric with a drillDownReportId points at a report that actually exists in the Report Registry', () => {
    const reportIds = new Set(REPORT_REGISTRY.map((report) => report.id));
    for (const metric of METRIC_REGISTRY) {
      if (metric.drillDownReportId) {
        expect(reportIds.has(metric.drillDownReportId)).toBe(true);
      }
    }
  });

  it('every metric marked BLOCKED_DATA_GAP carries a non-empty limitation explaining why', () => {
    for (const metric of METRIC_REGISTRY) {
      if (metric.availability === 'BLOCKED_DATA_GAP') {
        expect(metric.limitation).toBeTruthy();
      }
    }
  });
});

describe('Report Registry', () => {
  const permissionKeys = new Set(PERMISSION_CATALOGUE.map((entry) => entry.key));

  it('every report id is unique', () => {
    const ids = REPORT_REGISTRY.map((report) => report.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every report's requiredPermission is a real, existing catalogue entry", () => {
    for (const report of REPORT_REGISTRY) {
      expect(permissionKeys.has(report.requiredPermission)).toBe(true);
    }
  });

  it("every report's sortableFields are a subset of its own column keys", () => {
    for (const report of REPORT_REGISTRY) {
      const columnKeys = new Set(report.columns.map((col) => col.key));
      for (const field of report.sortableFields) {
        expect(columnKeys.has(field)).toBe(true);
      }
    }
  });

  it('every column has a non-empty key and label', () => {
    for (const report of REPORT_REGISTRY) {
      for (const column of report.columns) {
        expect(column.key.length).toBeGreaterThan(0);
        expect(column.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('every report marked exportEligible actually has a matching controller /export route — catches registry/controller drift', () => {
    const controllerSource = readFileSync(join(__dirname, 'reporting.controller.ts'), 'utf-8');
    for (const report of REPORT_REGISTRY) {
      if (report.exportEligible) {
        expect(controllerSource).toMatch(new RegExp(`@Get\\('reports/${report.id}/export'\\)`));
      }
    }
  });
});
