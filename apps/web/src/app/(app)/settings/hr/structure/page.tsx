'use client';

import { useQuery } from '@tanstack/react-query';

import { HrTabs } from '@/components/app/hr-tabs';
import { ApiError } from '@/lib/api-client';

import { OrganisationStructure, getOrganisationStructure } from '../api';
import { EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_STATUS_VARIANT } from '../labels';
import { Badge } from '@zentuva/ui';

type Department = OrganisationStructure['departments'][number];
type Employee = OrganisationStructure['employees'][number];

/**
 * Organisation Structure (Sprint 23, docs/domains/hr.md) — a structured
 * list/tree view for a future organisation chart. Deliberately not a
 * graph-rendering library — a nested list is enough for this sprint.
 */
export default function OrganisationStructurePage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['hr-structure'],
    queryFn: () => getOrganisationStructure(),
  });

  const topLevel = (data?.departments ?? []).filter((d) => !d.parentDepartmentId);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Human Resources</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Department hierarchy, members, and reporting lines.
        </p>
      </div>

      <HrTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading structure…</p>
      )}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load structure.'}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {data && (
        <div className="space-y-4">
          {topLevel.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">No departments yet.</p>
          )}
          {topLevel.map((department) => (
            <DepartmentNode key={department.id} department={department} data={data} depth={0} />
          ))}
        </div>
      )}
    </main>
  );
}

function DepartmentNode({
  department,
  data,
  depth,
}: {
  department: Department;
  data: OrganisationStructure;
  depth: number;
}) {
  const children = data.departments.filter((d) => d.parentDepartmentId === department.id);
  const members = data.employees.filter((e) => e.departmentId === department.id);
  const head = department.departmentHeadEmployeeId
    ? data.employees.find((e) => e.id === department.departmentHeadEmployeeId)
    : undefined;

  return (
    <div className="rounded-xl border border-border p-4" style={{ marginLeft: depth * 24 }}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{department.name}</h2>
        <span className="font-mono text-xs text-muted-foreground">{department.code}</span>
        {head && (
          <span className="text-xs text-muted-foreground">
            · Head: {head.firstName} {head.lastName}
          </span>
        )}
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No employees in this department.</p>
      ) : (
        <ul className="space-y-1">
          {members.map((employee) => (
            <EmployeeRow key={employee.id} employee={employee} data={data} />
          ))}
        </ul>
      )}

      {children.length > 0 && (
        <div className="mt-4 space-y-4">
          {children.map((child) => (
            <DepartmentNode key={child.id} department={child} data={data} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmployeeRow({ employee, data }: { employee: Employee; data: OrganisationStructure }) {
  const position = employee.positionId
    ? data.positions.find((p) => p.id === employee.positionId)
    : undefined;
  const manager = employee.managerEmployeeId
    ? data.employees.find((e) => e.id === employee.managerEmployeeId)
    : undefined;

  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <a href={`/settings/hr/employees/${employee.id}`} className="text-primary">
        {employee.firstName} {employee.lastName}
      </a>
      <span className="text-muted-foreground">{position?.title ?? 'No position'}</span>
      {manager && (
        <span className="text-xs text-muted-foreground">
          → reports to {manager.firstName} {manager.lastName}
        </span>
      )}
      <Badge variant={EMPLOYMENT_STATUS_VARIANT[employee.employmentStatus]}>
        {EMPLOYMENT_STATUS_LABELS[employee.employmentStatus]}
      </Badge>
    </li>
  );
}
