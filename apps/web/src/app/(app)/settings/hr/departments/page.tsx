'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Dialog,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  Textarea,
} from '@zentuva/ui';

import { HrTabs } from '@/components/app/hr-tabs';
import { ApiError } from '@/lib/api-client';

import {
  Department,
  activateDepartment,
  createDepartment,
  deactivateDepartment,
  listDepartments,
  listEmployees,
  updateDepartment,
} from '../api';
import { DEPARTMENT_STATUS_LABELS, DEPARTMENT_STATUS_VARIANT } from '../labels';

export default function DepartmentsPage() {
  const [editing, setEditing] = useState<Department | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['hr-departments-full'],
    queryFn: () => listDepartments(),
  });

  const departments = data?.items ?? [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Human Resources</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organisational units — teams, not application permissions.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New Department</Button>
      </div>

      <HrTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading departments…</p>
      )}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load departments.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && departments.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">No departments yet.</p>
      )}

      {!isLoading && !isError && departments.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Parent</th>
                <th className="px-4 py-3">Employees</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {departments.map((department) => (
                <tr key={department.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{department.code}</td>
                  <td className="px-4 py-3 font-medium">{department.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {departments.find((d) => d.id === department.parentDepartmentId)?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`/settings/hr/employees?departmentId=${department.id}`}
                      className="text-primary"
                    >
                      {department.employeeCount ?? 0}
                    </a>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={DEPARTMENT_STATUS_VARIANT[department.status]}>
                      {DEPARTMENT_STATUS_LABELS[department.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => setEditing(department)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <DepartmentDialog
          departments={departments}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            refetch();
          }}
        />
      )}
      {editing && (
        <DepartmentDialog
          department={editing}
          departments={departments}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refetch();
          }}
        />
      )}
    </main>
  );
}

function DepartmentDialog({
  department,
  departments,
  onClose,
  onSaved,
}: {
  department?: Department;
  departments: Department[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(department?.code ?? '');
  const [name, setName] = useState(department?.name ?? '');
  const [description, setDescription] = useState(department?.description ?? '');
  const [parentDepartmentId, setParentDepartmentId] = useState(
    department?.parentDepartmentId ?? '',
  );

  const { data: employeesData } = useQuery({
    queryKey: ['hr-employees', 'for-dept-head'],
    queryFn: () => listEmployees({ pageSize: 100 }),
  });
  const [departmentHeadEmployeeId, setDepartmentHeadEmployeeId] = useState(
    department?.departmentHeadEmployeeId ?? '',
  );
  const headCandidates = (employeesData?.items ?? []).filter(
    (employee) => employee.employmentStatus !== 'SEPARATED',
  );

  const activateMutation = useMutation({ mutationFn: () => activateDepartment(department!.id) });
  const deactivateMutation = useMutation({
    mutationFn: () => deactivateDepartment(department!.id),
  });

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        parentDepartmentId: parentDepartmentId || undefined,
        departmentHeadEmployeeId: departmentHeadEmployeeId || undefined,
      };
      return department ? updateDepartment(department.id, payload) : createDepartment(payload);
    },
    onSuccess: onSaved,
  });

  const canSubmit = code.trim().length > 0 && name.trim().length > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogHeader>
        <DialogTitle>{department ? 'Edit Department' : 'New Department'}</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[70vh] space-y-4 overflow-y-auto"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) mutation.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={!!department} />
          </div>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Description</Label>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Parent Department</Label>
          <Select
            value={parentDepartmentId}
            onChange={(e) => setParentDepartmentId(e.target.value)}
          >
            <option value="">None</option>
            {departments
              .filter((d) => d.id !== department?.id)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Department Head</Label>
          <Select
            value={departmentHeadEmployeeId}
            onChange={(e) => setDepartmentHeadEmployeeId(e.target.value)}
          >
            <option value="">None</option>
            {headCandidates.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.firstName} {employee.lastName}
              </option>
            ))}
          </Select>
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to save department.'}
          </p>
        )}

        <div className="flex items-center justify-between pt-2">
          <div>
            {department &&
              (department.status === 'ACTIVE' ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={deactivateMutation.isPending}
                  onClick={() => deactivateMutation.mutate(undefined, { onSuccess: onSaved })}
                >
                  Deactivate
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={activateMutation.isPending}
                  onClick={() => activateMutation.mutate(undefined, { onSuccess: onSaved })}
                >
                  Activate
                </Button>
              ))}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
