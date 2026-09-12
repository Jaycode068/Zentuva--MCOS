'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Input, Select } from '@zentuva/ui';

import { HrTabs } from '@/components/app/hr-tabs';
import { ApiError } from '@/lib/api-client';

import {
  EmploymentStatus,
  EmploymentType,
  listDepartments,
  listEmployees,
  listPositions,
} from '../api';
import {
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_STATUS_VARIANT,
  EMPLOYMENT_TYPE_LABELS,
} from '../labels';

const PAGE_SIZE = 20;

export default function EmployeesPage() {
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [employmentType, setEmploymentType] = useState<EmploymentType | ''>('');
  const [employmentStatus, setEmploymentStatus] = useState<EmploymentStatus | ''>('');
  const [page, setPage] = useState(1);

  const { data: departmentsData } = useQuery({
    queryKey: ['hr-departments'],
    queryFn: () => listDepartments(),
  });
  const { data: positionsData } = useQuery({
    queryKey: ['hr-positions'],
    queryFn: () => listPositions(),
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [
      'hr-employees',
      search,
      departmentId,
      positionId,
      employmentType,
      employmentStatus,
      page,
    ],
    queryFn: () =>
      listEmployees({
        search: search || undefined,
        departmentId: departmentId || undefined,
        positionId: positionId || undefined,
        employmentType: employmentType || undefined,
        employmentStatus: employmentStatus || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  const employees = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Human Resources</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The employee directory — search, filter, and manage records.
          </p>
        </div>
        <Button onClick={() => window.location.assign('/settings/hr/employees/new')}>
          New Employee
        </Button>
      </div>

      <HrTabs />

      <div className="mb-6 flex flex-wrap gap-3">
        <Input
          placeholder="Search code, name, or email…"
          value={search}
          onChange={(event) => {
            setPage(1);
            setSearch(event.target.value);
          }}
          className="max-w-xs"
        />
        <Select
          value={departmentId}
          onChange={(event) => {
            setPage(1);
            setDepartmentId(event.target.value);
          }}
          className="max-w-[10rem]"
        >
          <option value="">All Departments</option>
          {(departmentsData?.items ?? []).map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </Select>
        <Select
          value={positionId}
          onChange={(event) => {
            setPage(1);
            setPositionId(event.target.value);
          }}
          className="max-w-[10rem]"
        >
          <option value="">All Positions</option>
          {(positionsData?.items ?? []).map((position) => (
            <option key={position.id} value={position.id}>
              {position.title}
            </option>
          ))}
        </Select>
        <Select
          value={employmentStatus}
          onChange={(event) => {
            setPage(1);
            setEmploymentStatus(event.target.value as EmploymentStatus | '');
          }}
          className="max-w-[10rem]"
        >
          <option value="">All Statuses</option>
          {Object.entries(EMPLOYMENT_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          value={employmentType}
          onChange={(event) => {
            setPage(1);
            setEmploymentType(event.target.value as EmploymentType | '');
          }}
          className="max-w-[10rem]"
        >
          <option value="">All Types</option>
          {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading employees…</p>
      )}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load employees.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && employees.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No employees match these filters.
        </p>
      )}

      {!isLoading && !isError && employees.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Position</th>
                  <th className="px-4 py-3">Manager</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Hire Date</th>
                  <th className="px-4 py-3">Account</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr
                    key={employee.id}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                    onClick={() => window.location.assign(`/settings/hr/employees/${employee.id}`)}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium">
                        {employee.firstName} {employee.lastName}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {employee.employeeCode}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {employee.department?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {employee.position?.title ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {employee.manager
                        ? `${employee.manager.firstName} ${employee.manager.lastName}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={EMPLOYMENT_STATUS_VARIANT[employee.employmentStatus]}>
                        {EMPLOYMENT_STATUS_LABELS[employee.employmentStatus]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(employee.hireDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      {employee.user ? (
                        <span className="text-xs text-primary">Linked</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not linked</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {employees.map((employee) => (
              <button
                key={employee.id}
                type="button"
                onClick={() => window.location.assign(`/settings/hr/employees/${employee.id}`)}
                className="w-full rounded-lg border border-border p-3 text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate font-medium">
                    {employee.firstName} {employee.lastName}
                  </p>
                  <Badge variant={EMPLOYMENT_STATUS_VARIANT[employee.employmentStatus]}>
                    {EMPLOYMENT_STATUS_LABELS[employee.employmentStatus]}
                  </Badge>
                </div>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {employee.employeeCode}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {employee.department?.name ?? 'No department'} ·{' '}
                  {employee.position?.title ?? 'No position'}
                </p>
              </button>
            ))}
          </div>

          <div className="mt-6 flex items-center justify-between text-sm text-muted-foreground">
            <p>
              Page {page} of {totalPages} · {total} employee{total === 1 ? '' : 's'}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
