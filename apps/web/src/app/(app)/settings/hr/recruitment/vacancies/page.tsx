'use client';

import { Suspense, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  Sheet,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Textarea,
} from '@zentuva/ui';

import { HrTabs } from '@/components/app/hr-tabs';
import { ApiError } from '@/lib/api-client';

import { listDepartments, listPositions } from '../../api';
import {
  CreateVacancyPayload,
  EmploymentType,
  VacancyStatus,
  WorkArrangement,
  createVacancy,
  listVacancies,
} from '../api';
import { VACANCY_STATUS_LABELS, VACANCY_STATUS_VARIANT } from '../labels';

const EMPLOYMENT_TYPES: EmploymentType[] = [
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'TEMPORARY',
  'INTERN',
  'CASUAL',
  'VOLUNTEER',
];
const WORK_ARRANGEMENTS: WorkArrangement[] = ['ON_SITE', 'REMOTE', 'HYBRID'];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export default function VacanciesPage() {
  return (
    <Suspense fallback={null}>
      <VacanciesPageContent />
    </Suspense>
  );
}

function VacanciesPageContent() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const hiringRequestId = searchParams.get('hiringRequestId') ?? undefined;
  const [statusFilter, setStatusFilter] = useState<'' | VacancyStatus>('');
  const [sheetOpen, setSheetOpen] = useState(Boolean(hiringRequestId));

  const [form, setForm] = useState<Partial<CreateVacancyPayload>>({
    numberOfOpenings: 1,
    employmentType: 'FULL_TIME',
    workArrangement: 'ON_SITE',
    hiringRequestId,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['hr-departments'],
    queryFn: () => listDepartments(),
    select: (result) => result.items,
  });
  const { data: positions = [] } = useQuery({
    queryKey: ['hr-positions'],
    queryFn: () => listPositions(),
    select: (result) => result.items,
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['recruitment-vacancies', statusFilter],
    queryFn: () => listVacancies({ status: statusFilter || undefined }),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createVacancy({
        title: form.title ?? '',
        positionId: form.positionId ?? '',
        departmentId: form.departmentId,
        hiringRequestId: form.hiringRequestId,
        numberOfOpenings: form.numberOfOpenings ?? 1,
        employmentType: form.employmentType ?? 'FULL_TIME',
        workArrangement: form.workArrangement ?? 'ON_SITE',
        location: form.location,
        description: form.description ?? '',
        responsibilities: form.responsibilities ?? '',
        requirements: form.requirements ?? '',
        qualifications: form.qualifications ?? '',
        applicationDeadline: form.applicationDeadline,
        publicSlug: form.publicSlug || slugify(form.title ?? ''),
        questions: [],
      }),
    onSuccess: (vacancy) => {
      queryClient.invalidateQueries({ queryKey: ['recruitment-vacancies'] });
      setSheetOpen(false);
      window.location.assign(`/settings/hr/recruitment/vacancies/${vacancy.id}`);
    },
  });

  const vacancies = data ?? [];

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Human Resources</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Vacancies — specific recruitment opportunities for a position.
          </p>
        </div>
        <Button onClick={() => setSheetOpen(true)}>New Vacancy</Button>
      </div>

      <HrTabs />

      <div className="mb-4 flex flex-wrap gap-2">
        {(['', 'DRAFT', 'PUBLISHED', 'PAUSED', 'CLOSED', 'CANCELLED'] as const).map((status) => (
          <Button
            key={status || 'all'}
            size="sm"
            variant={statusFilter === status ? 'default' : 'outline'}
            onClick={() => setStatusFilter(status)}
          >
            {status ? VACANCY_STATUS_LABELS[status] : 'All'}
          </Button>
        ))}
      </div>

      {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load vacancies.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="space-y-3">
          {vacancies.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No vacancies match this filter.
            </p>
          )}
          {vacancies.map((vacancy) => (
            <a
              key={vacancy.id}
              href={`/settings/hr/recruitment/vacancies/${vacancy.id}`}
              className="block rounded-lg border border-border p-4 hover:bg-secondary/50"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{vacancy.title}</span>
                  <Badge variant={VACANCY_STATUS_VARIANT[vacancy.status]}>
                    {VACANCY_STATUS_LABELS[vacancy.status]}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  /careers/…/{vacancy.publicSlug}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {vacancy.department?.name ?? 'No department'} · {vacancy.numberOfOpenings}{' '}
                opening(s)
                {vacancy.location ? ` · ${vacancy.location}` : ''}
              </p>
            </a>
          ))}
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen} side="full">
        <SheetHeader>
          <SheetTitle>New Vacancy</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 py-4">
          <div>
            <Label>Title</Label>
            <Input
              value={form.title ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Cashier"
            />
          </div>
          <div>
            <Label>Position</Label>
            <Select
              value={form.positionId ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, positionId: e.target.value }))}
            >
              <option value="">Select position…</option>
              {positions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Department</Label>
            <Select
              value={form.departmentId ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
            >
              <option value="">Select department…</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Openings</Label>
              <Input
                type="number"
                min={1}
                value={form.numberOfOpenings ?? 1}
                onChange={(e) =>
                  setForm((f) => ({ ...f, numberOfOpenings: Number(e.target.value) || 1 }))
                }
              />
            </div>
            <div>
              <Label>Location</Label>
              <Input
                value={form.location ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Employment Type</Label>
              <Select
                value={form.employmentType ?? 'FULL_TIME'}
                onChange={(e) =>
                  setForm((f) => ({ ...f, employmentType: e.target.value as EmploymentType }))
                }
              >
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Work Arrangement</Label>
              <Select
                value={form.workArrangement ?? 'ON_SITE'}
                onChange={(e) =>
                  setForm((f) => ({ ...f, workArrangement: e.target.value as WorkArrangement }))
                }
              >
                {WORK_ARRANGEMENTS.map((w) => (
                  <option key={w} value={w}>
                    {w.replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label>Application Deadline</Label>
            <Input
              type="date"
              value={form.applicationDeadline ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, applicationDeadline: e.target.value }))}
            />
          </div>
          <div>
            <Label>Public URL Slug</Label>
            <Input
              value={form.publicSlug ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, publicSlug: slugify(e.target.value) }))}
              placeholder={slugify(form.title ?? '') || 'cashier'}
            />
          </div>
          <div>
            <Label>About the Role</Label>
            <Textarea
              value={form.description ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div>
            <Label>Responsibilities</Label>
            <Textarea
              value={form.responsibilities ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, responsibilities: e.target.value }))}
            />
          </div>
          <div>
            <Label>Requirements</Label>
            <Textarea
              value={form.requirements ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, requirements: e.target.value }))}
            />
          </div>
          <div>
            <Label>Qualifications</Label>
            <Textarea
              value={form.qualifications ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, qualifications: e.target.value }))}
            />
          </div>
        </div>
        <SheetFooter>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={
              !form.title ||
              !form.positionId ||
              !form.description ||
              !form.responsibilities ||
              !form.requirements ||
              !form.qualifications ||
              createMutation.isPending
            }
          >
            Create Vacancy
          </Button>
        </SheetFooter>
      </Sheet>
    </main>
  );
}
