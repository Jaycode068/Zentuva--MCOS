'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  Sheet,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Textarea,
} from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';
import { listUsers } from '@/app/(app)/settings/users/api';

import {
  EmployeeDocumentType,
  activateEmployee,
  addEmployeeDocument,
  assignEmployeeDepartment,
  assignEmployeeManager,
  assignEmployeePosition,
  completeOnboarding,
  completeOnboardingTask,
  getEmployee,
  getEmployeeAuditHistory,
  getEmployeeOnboarding,
  linkEmployeeUser,
  listDepartments,
  listEmployeeDocuments,
  listEmployees,
  listPositions,
  reactivateEmployee,
  separateEmployee,
  startOnboarding,
  suspendEmployee,
  unlinkEmployeeUser,
} from '../../api';
import {
  EMPLOYEE_DOCUMENT_TYPE_LABELS,
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_STATUS_VARIANT,
  EMPLOYMENT_TYPE_LABELS,
  GENDER_LABELS,
  ONBOARDING_STATUS_LABELS,
  ONBOARDING_STATUS_VARIANT,
} from '../../labels';

export default function EmployeeDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();

  const {
    data: employee,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({ queryKey: ['hr-employee', id], queryFn: () => getEmployee(id) });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['hr-employee', id] });
    queryClient.invalidateQueries({ queryKey: ['hr-employees'] });
    queryClient.invalidateQueries({ queryKey: ['hr-overview'] });
    queryClient.invalidateQueries({ queryKey: ['hr-audit', id] });
  };

  if (isLoading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 text-sm text-muted-foreground">
        Loading employee…
      </main>
    );
  }
  if (isError || !employee) {
    return (
      <main className="mx-auto max-w-3xl space-y-3 px-4 py-10 text-center">
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load employee.'}
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <div>
        <a href="/settings/hr/employees" className="text-sm text-muted-foreground">
          ← All Employees
        </a>
      </div>

      <HeaderSection employee={employee} onChanged={invalidate} />
      <ContactSection employee={employee} />
      <OrganisationSection employee={employee} onChanged={invalidate} />
      <ReportingSection employee={employee} onChanged={invalidate} />
      <UserLinkSection employeeId={id} employee={employee} onChanged={invalidate} />
      <OnboardingSection
        employeeId={id}
        employmentStatus={employee.employmentStatus}
        onChanged={invalidate}
      />
      <DocumentsSection employeeId={id} onChanged={invalidate} />
      <AuditSection employeeId={id} />
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

type EmployeeDetail = Awaited<ReturnType<typeof getEmployee>>;

function HeaderSection({
  employee,
  onChanged,
}: {
  employee: EmployeeDetail;
  onChanged: () => void;
}) {
  const [separateOpen, setSeparateOpen] = useState(false);

  const activateMutation = useMutation({
    mutationFn: () => activateEmployee(employee.id),
    onSuccess: onChanged,
  });
  const suspendMutation = useMutation({
    mutationFn: () => suspendEmployee(employee.id),
    onSuccess: onChanged,
  });
  const reactivateMutation = useMutation({
    mutationFn: () => reactivateEmployee(employee.id),
    onSuccess: onChanged,
  });

  const status = employee.employmentStatus;
  const primaryError = [activateMutation, suspendMutation, reactivateMutation].find(
    (m) => m.isError,
  );

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <Badge variant={EMPLOYMENT_STATUS_VARIANT[status]}>
          {EMPLOYMENT_STATUS_LABELS[status]}
        </Badge>
        {!employee.user && <Badge variant="default">No linked user</Badge>}
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">
        {employee.firstName} {employee.lastName}
      </h1>
      <p className="font-mono text-xs text-muted-foreground">{employee.employeeCode}</p>

      {primaryError && (
        <p className="mt-2 text-sm text-destructive">
          {primaryError.error instanceof ApiError
            ? primaryError.error.message
            : 'That action could not be completed.'}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {(status === 'DRAFT' || status === 'ONBOARDING') && (
          <Button
            size="sm"
            disabled={activateMutation.isPending}
            onClick={() => activateMutation.mutate()}
          >
            Activate
          </Button>
        )}
        {status === 'ACTIVE' && (
          <Button
            size="sm"
            variant="outline"
            disabled={suspendMutation.isPending}
            onClick={() => suspendMutation.mutate()}
          >
            Suspend
          </Button>
        )}
        {status === 'SUSPENDED' && (
          <Button
            size="sm"
            disabled={reactivateMutation.isPending}
            onClick={() => reactivateMutation.mutate()}
          >
            Reactivate
          </Button>
        )}
        {status !== 'SEPARATED' && (
          <Button size="sm" variant="outline" onClick={() => setSeparateOpen(true)}>
            Separate
          </Button>
        )}
      </div>

      <SeparateSheet
        employeeId={employee.id}
        open={separateOpen}
        onOpenChange={setSeparateOpen}
        onSeparated={onChanged}
      />
    </div>
  );
}

function SeparateSheet({
  employeeId,
  open,
  onOpenChange,
  onSeparated,
}: {
  employeeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSeparated: () => void;
}) {
  const [separationDate, setSeparationDate] = useState('');
  const [separationReason, setSeparationReason] = useState('');

  const mutation = useMutation({
    mutationFn: () => separateEmployee(employeeId, separationDate, separationReason || undefined),
    onSuccess: () => {
      onOpenChange(false);
      onSeparated();
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} side="full">
      <SheetHeader>
        <SheetTitle>Separate Employee</SheetTitle>
      </SheetHeader>
      <div className="flex-1 space-y-4 overflow-y-auto">
        <p className="text-sm text-muted-foreground">
          This is a terminal action — the employee record stays visible for history, but no further
          lifecycle changes will be possible.
        </p>
        <div className="space-y-1.5">
          <Label className="text-base">Separation Date</Label>
          <Input
            type="date"
            className="h-12 text-base"
            value={separationDate}
            onChange={(e) => setSeparationDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-base">Reason (optional)</Label>
          <Textarea
            rows={3}
            className="text-base"
            value={separationReason}
            onChange={(e) => setSeparationReason(e.target.value)}
          />
        </div>
        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to separate employee.'}
          </p>
        )}
      </div>
      <SheetFooter>
        <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          className="w-full"
          disabled={!separationDate || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Separating…' : 'Confirm Separation'}
        </Button>
      </SheetFooter>
    </Sheet>
  );
}

function ContactSection({ employee }: { employee: EmployeeDetail }) {
  return (
    <Section title="Contact Information">
      <Field label="Work Email" value={employee.workEmail ?? '—'} />
      <Field label="Personal Email" value={employee.personalEmail ?? '—'} />
      <Field label="Phone" value={employee.phoneNumber ?? '—'} />
      <Field label="Alternate Phone" value={employee.alternatePhoneNumber ?? '—'} />
      <Field
        label="Date of Birth"
        value={employee.dateOfBirth ? new Date(employee.dateOfBirth).toLocaleDateString() : '—'}
      />
      <Field label="Gender" value={employee.gender ? GENDER_LABELS[employee.gender] : '—'} />
      <Field label="Nationality" value={employee.nationality ?? '—'} />
      <Field label="Address" value={employee.address ?? '—'} />
      <Field label="Emergency Contact" value={employee.emergencyContactName ?? '—'} />
      <Field label="Emergency Phone" value={employee.emergencyContactPhone ?? '—'} />
      <Field label="Relationship" value={employee.emergencyContactRelationship ?? '—'} />
      <div className="border-t border-border pt-3">
        <Field label="Employment Type" value={EMPLOYMENT_TYPE_LABELS[employee.employmentType]} />
        <Field label="Hire Date" value={new Date(employee.hireDate).toLocaleDateString()} />
        <Field
          label="Probation End"
          value={
            employee.probationEndDate
              ? new Date(employee.probationEndDate).toLocaleDateString()
              : '—'
          }
        />
        {employee.employmentStatus === 'SEPARATED' && (
          <>
            <Field
              label="Separation Date"
              value={
                employee.separationDate
                  ? new Date(employee.separationDate).toLocaleDateString()
                  : '—'
              }
            />
            <Field label="Separation Reason" value={employee.separationReason ?? '—'} />
          </>
        )}
        {employee.notes && <Field label="Notes" value={employee.notes} />}
      </div>
    </Section>
  );
}

function OrganisationSection({
  employee,
  onChanged,
}: {
  employee: EmployeeDetail;
  onChanged: () => void;
}) {
  const { data: departmentsData } = useQuery({
    queryKey: ['hr-departments'],
    queryFn: () => listDepartments({ status: 'ACTIVE' }),
  });
  const { data: positionsData } = useQuery({
    queryKey: ['hr-positions'],
    queryFn: () => listPositions({ status: 'ACTIVE' }),
  });

  const [departmentId, setDepartmentId] = useState(employee.departmentId ?? '');
  const [positionId, setPositionId] = useState(employee.positionId ?? '');

  const departmentMutation = useMutation({
    mutationFn: () => assignEmployeeDepartment(employee.id, departmentId || null),
    onSuccess: onChanged,
  });
  const positionMutation = useMutation({
    mutationFn: () => assignEmployeePosition(employee.id, positionId || null),
    onSuccess: onChanged,
  });

  return (
    <Section title="Department & Position">
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs">Department</Label>
          <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">None</option>
            {(departmentsData?.items ?? []).map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>
        </div>
        <Button
          size="sm"
          disabled={departmentMutation.isPending || departmentId === (employee.departmentId ?? '')}
          onClick={() => departmentMutation.mutate()}
        >
          Save
        </Button>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs">Position</Label>
          <Select value={positionId} onChange={(e) => setPositionId(e.target.value)}>
            <option value="">None</option>
            {(positionsData?.items ?? []).map((position) => (
              <option key={position.id} value={position.id}>
                {position.title}
              </option>
            ))}
          </Select>
        </div>
        <Button
          size="sm"
          disabled={positionMutation.isPending || positionId === (employee.positionId ?? '')}
          onClick={() => positionMutation.mutate()}
        >
          Save
        </Button>
      </div>
      {(departmentMutation.isError || positionMutation.isError) && (
        <p className="text-sm text-destructive">Failed to update assignment.</p>
      )}
    </Section>
  );
}

function ReportingSection({
  employee,
  onChanged,
}: {
  employee: EmployeeDetail;
  onChanged: () => void;
}) {
  const { data: employeesData } = useQuery({
    queryKey: ['hr-employees', 'for-manager-picker'],
    queryFn: () => listEmployees({ pageSize: 100 }),
  });
  const candidates = (employeesData?.items ?? []).filter(
    (candidate) => candidate.id !== employee.id && candidate.employmentStatus !== 'SEPARATED',
  );

  const [managerEmployeeId, setManagerEmployeeId] = useState(employee.managerEmployeeId ?? '');
  const mutation = useMutation({
    mutationFn: () => assignEmployeeManager(employee.id, managerEmployeeId || null),
    onSuccess: onChanged,
  });

  return (
    <Section title="Reporting Line">
      <Field label="Direct Reports" value={String(employee._count?.directReports ?? 0)} />
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs">Manager</Label>
          <Select value={managerEmployeeId} onChange={(e) => setManagerEmployeeId(e.target.value)}>
            <option value="">No manager</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.firstName} {candidate.lastName} ({candidate.employeeCode})
              </option>
            ))}
          </Select>
        </div>
        <Button
          size="sm"
          disabled={mutation.isPending || managerEmployeeId === (employee.managerEmployeeId ?? '')}
          onClick={() => mutation.mutate()}
        >
          Save
        </Button>
      </div>
      {mutation.isError && (
        <p className="text-sm text-destructive">
          {mutation.error instanceof ApiError
            ? mutation.error.message
            : 'Failed to update manager.'}
        </p>
      )}
    </Section>
  );
}

function UserLinkSection({
  employeeId,
  employee,
  onChanged,
}: {
  employeeId: string;
  employee: EmployeeDetail;
  onChanged: () => void;
}) {
  const { data: usersData } = useQuery({ queryKey: ['users'], queryFn: () => listUsers() });
  const [userId, setUserId] = useState('');

  const linkMutation = useMutation({
    mutationFn: () => linkEmployeeUser(employeeId, userId),
    onSuccess: onChanged,
  });
  const unlinkMutation = useMutation({
    mutationFn: () => unlinkEmployeeUser(employeeId),
    onSuccess: onChanged,
  });

  return (
    <Section title="User Account Link">
      {employee.user ? (
        <>
          <Field label="Linked Account" value={employee.user.email} />
          <Button
            size="sm"
            variant="outline"
            disabled={unlinkMutation.isPending}
            onClick={() => unlinkMutation.mutate()}
          >
            Unlink
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Not every employee needs a login account. Link one only if this person should sign in to
            Zentuva.
          </p>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs">User</Label>
              <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Select a user…</option>
                {(usersData?.items ?? []).map((user: { id: string; email: string }) => (
                  <option key={user.id} value={user.id}>
                    {user.email}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              size="sm"
              disabled={!userId || linkMutation.isPending}
              onClick={() => linkMutation.mutate()}
            >
              Link
            </Button>
          </div>
        </>
      )}
      {(linkMutation.isError || unlinkMutation.isError) && (
        <p className="text-sm text-destructive">
          {linkMutation.error instanceof ApiError
            ? linkMutation.error.message
            : 'Failed to update the linked account.'}
        </p>
      )}
    </Section>
  );
}

function OnboardingSection({
  employeeId,
  employmentStatus,
  onChanged,
}: {
  employeeId: string;
  employmentStatus: EmployeeDetail['employmentStatus'];
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: onboarding, isLoading } = useQuery({
    queryKey: ['hr-onboarding', employeeId],
    queryFn: () => getEmployeeOnboarding(employeeId),
    retry: false,
  });

  const startMutation = useMutation({
    mutationFn: () => startOnboarding(employeeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-onboarding', employeeId] });
      onChanged();
    },
  });
  const taskMutation = useMutation({
    mutationFn: (taskId: string) => completeOnboardingTask(employeeId, taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-onboarding', employeeId] });
      onChanged();
    },
  });
  const completeMutation = useMutation({
    mutationFn: () => completeOnboarding(employeeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-onboarding', employeeId] });
      onChanged();
    },
  });

  if (isLoading) {
    return (
      <Section title="Onboarding">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Section>
    );
  }

  if (!onboarding) {
    return (
      <Section title="Onboarding">
        <p className="text-sm text-muted-foreground">Onboarding has not been started.</p>
        {employmentStatus !== 'SEPARATED' && (
          <Button
            size="sm"
            disabled={startMutation.isPending}
            onClick={() => startMutation.mutate()}
          >
            Start Onboarding
          </Button>
        )}
      </Section>
    );
  }

  const incompleteRequired = onboarding.tasks.filter((t) => t.isRequired && !t.completedAt);

  return (
    <Section title="Onboarding">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant={ONBOARDING_STATUS_VARIANT[onboarding.status]}>
          {ONBOARDING_STATUS_LABELS[onboarding.status]}
        </Badge>
        {onboarding.targetCompletionDate && (
          <span className="text-xs text-muted-foreground">
            Target: {new Date(onboarding.targetCompletionDate).toLocaleDateString()}
          </span>
        )}
      </div>
      <ul className="space-y-2">
        {onboarding.tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-3">
            <button
              type="button"
              disabled={!!task.completedAt || taskMutation.isPending}
              onClick={() => taskMutation.mutate(task.id)}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm ${
                task.completedAt
                  ? 'border-success bg-success text-success-foreground'
                  : 'border-border'
              }`}
              aria-label={`Mark "${task.title}" complete`}
            >
              {task.completedAt ? '✓' : ''}
            </button>
            <span
              className={`text-sm ${task.completedAt ? 'text-muted-foreground line-through' : ''}`}
            >
              {task.title}
              {task.isRequired && !task.completedAt && (
                <span className="ml-1 text-xs text-destructive">*</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {onboarding.status !== 'COMPLETED' && (
        <div>
          <Button
            size="sm"
            disabled={completeMutation.isPending}
            onClick={() => completeMutation.mutate()}
          >
            Complete Onboarding
          </Button>
          {incompleteRequired.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {incompleteRequired.length} required task(s) remaining:{' '}
              {incompleteRequired.map((t) => t.title).join(', ')}
            </p>
          )}
          {completeMutation.isError && (
            <p className="mt-2 text-sm text-destructive">
              {completeMutation.error instanceof ApiError
                ? completeMutation.error.message
                : 'Cannot complete onboarding yet.'}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

function DocumentsSection({
  employeeId,
  onChanged,
}: {
  employeeId: string;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [documentType, setDocumentType] = useState<EmployeeDocumentType>('OTHER');
  const [name, setName] = useState('');

  const { data } = useQuery({
    queryKey: ['hr-documents', employeeId],
    queryFn: () => listEmployeeDocuments(employeeId),
  });

  const mutation = useMutation({
    mutationFn: ({ file }: { file: File }) =>
      addEmployeeDocument(employeeId, file, documentType, name || file.name),
    onSuccess: () => {
      setName('');
      queryClient.invalidateQueries({ queryKey: ['hr-documents', employeeId] });
      onChanged();
    },
  });

  return (
    <Section title="Documents">
      {(data?.items ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents on file.</p>
      ) : (
        <ul className="space-y-2">
          {data!.items.map((document) => (
            <li key={document.id} className="flex items-center justify-between text-sm">
              <div>
                <p>{document.name}</p>
                <p className="text-xs text-muted-foreground">
                  {EMPLOYEE_DOCUMENT_TYPE_LABELS[document.documentType]}
                </p>
              </div>
              <a
                href={document.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary"
              >
                View
              </a>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Type</Label>
          <Select
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value as EmployeeDocumentType)}
          >
            {Object.entries(EMPLOYEE_DOCUMENT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Document name"
          />
        </div>
        <label className="flex h-10 cursor-pointer items-center justify-center rounded-md border border-border px-4 text-sm font-medium">
          Upload
          <input
            type="file"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) mutation.mutate({ file });
            }}
          />
        </label>
      </div>
      {mutation.isError && (
        <p className="text-sm text-destructive">
          {mutation.error instanceof ApiError ? mutation.error.message : 'Failed to add document.'}
        </p>
      )}
    </Section>
  );
}

function AuditSection({ employeeId }: { employeeId: string }) {
  const { data } = useQuery({
    queryKey: ['hr-audit', employeeId],
    queryFn: () => getEmployeeAuditHistory(employeeId),
  });

  return (
    <Section title="Lifecycle History / Audit">
      {(data?.items ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No recorded activity yet.</p>
      ) : (
        <ul className="space-y-2">
          {data!.items.map((event) => (
            <li key={event.id} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {event.action.replace('hr.employee.', '').replace(/_/g, ' ')}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(event.createdAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
