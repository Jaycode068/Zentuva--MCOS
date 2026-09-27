'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { createWorkflowInstance, submitWorkflowInstance } from '../../../workflows/api';
import { listDepartments, listPositions } from '../../api';

import {
  EmploymentType,
  HiringRequestReason,
  HiringRequestStatus,
  approveHiringRequestDirectly,
  cancelHiringRequest,
  createHiringRequest,
  listHiringRequests,
  rejectHiringRequestDirectly,
  submitHiringRequest,
} from '../api';
import { HIRING_REQUEST_STATUS_LABELS, HIRING_REQUEST_STATUS_VARIANT } from '../labels';

const REASONS: { value: HiringRequestReason; label: string }[] = [
  { value: 'NEW_POSITION', label: 'New Position' },
  { value: 'REPLACEMENT', label: 'Replacement' },
  { value: 'EXPANSION', label: 'Expansion' },
  { value: 'OTHER', label: 'Other' },
];

const EMPLOYMENT_TYPES: EmploymentType[] = [
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'TEMPORARY',
  'INTERN',
  'CASUAL',
  'VOLUNTEER',
];

export default function HiringRequestsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'' | HiringRequestStatus>('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [departmentId, setDepartmentId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [headcount, setHeadcount] = useState('1');
  const [employmentType, setEmploymentType] = useState<EmploymentType>('FULL_TIME');
  const [reason, setReason] = useState<HiringRequestReason>('NEW_POSITION');
  const [justification, setJustification] = useState('');
  const [startDate, setStartDate] = useState('');

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
    queryKey: ['recruitment-hiring-requests', statusFilter],
    queryFn: () => listHiringRequests({ status: statusFilter || undefined }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['recruitment-hiring-requests'] });

  const createMutation = useMutation({
    mutationFn: () =>
      createHiringRequest({
        departmentId,
        positionId,
        requestedHeadcount: Number(headcount) || 1,
        employmentType,
        reason,
        justification: justification || undefined,
        requestedStartDate: startDate || undefined,
      }),
    onSuccess: () => {
      invalidate();
      setSheetOpen(false);
      setJustification('');
    },
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) => submitHiringRequest(id),
    onSuccess: invalidate,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveHiringRequestDirectly(id),
    onSuccess: invalidate,
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectHiringRequestDirectly(id),
    onSuccess: invalidate,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelHiringRequest(id),
    onSuccess: invalidate,
  });

  const routeForApprovalMutation = useMutation({
    mutationFn: async (id: string) => {
      const instance = await createWorkflowInstance({
        workflowDefinitionCode: 'HIRING_REQUEST_APPROVAL',
        subjectType: 'HIRING_REQUEST',
        subjectId: id,
      });
      return submitWorkflowInstance(instance.id);
    },
    onSuccess: invalidate,
  });

  const requests = data ?? [];

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Human Resources</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hiring Requests — formally request that a position be filled.
          </p>
        </div>
        <Button onClick={() => setSheetOpen(true)}>New Hiring Request</Button>
      </div>

      <HrTabs />

      <div className="mb-4 flex flex-wrap gap-2">
        {(['', 'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'] as const).map(
          (status) => (
            <Button
              key={status || 'all'}
              size="sm"
              variant={statusFilter === status ? 'default' : 'outline'}
              onClick={() => setStatusFilter(status)}
            >
              {status ? HIRING_REQUEST_STATUS_LABELS[status] : 'All'}
            </Button>
          ),
        )}
      </div>

      {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load hiring requests.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="space-y-3">
          {requests.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No hiring requests match this filter.
            </p>
          )}
          {requests.map((request) => (
            <div key={request.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {request.position?.title ?? request.positionId}
                    </span>
                    <Badge variant={HIRING_REQUEST_STATUS_VARIANT[request.status]}>
                      {HIRING_REQUEST_STATUS_LABELS[request.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {request.department?.name ?? request.departmentId} ·{' '}
                    {request.requestedHeadcount} opening(s) ·{' '}
                    {request.reason.replace('_', ' ').toLowerCase()}
                  </p>
                  {request.justification && (
                    <p className="mt-1 text-xs text-muted-foreground">{request.justification}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {request.status === 'DRAFT' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => submitMutation.mutate(request.id)}
                    >
                      Submit
                    </Button>
                  )}
                  {request.status === 'SUBMITTED' && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => routeForApprovalMutation.mutate(request.id)}
                      >
                        Route via Workflow
                      </Button>
                      <Button size="sm" onClick={() => approveMutation.mutate(request.id)}>
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => rejectMutation.mutate(request.id)}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                  {(request.status === 'DRAFT' || request.status === 'SUBMITTED') && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => cancelMutation.mutate(request.id)}
                    >
                      Cancel
                    </Button>
                  )}
                  {request.status === 'APPROVED' && (
                    <a
                      href={`/settings/hr/recruitment/vacancies?hiringRequestId=${request.id}`}
                      className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-secondary"
                    >
                      Create Vacancy
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen} side="full">
        <SheetHeader>
          <SheetTitle>New Hiring Request</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 py-4">
          <div>
            <Label>Department</Label>
            <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">Select department…</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Position</Label>
            <Select value={positionId} onChange={(e) => setPositionId(e.target.value)}>
              <option value="">Select position…</option>
              {positions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Number Required</Label>
            <Input
              type="number"
              min={1}
              value={headcount}
              onChange={(e) => setHeadcount(e.target.value)}
            />
          </div>
          <div>
            <Label>Employment Type</Label>
            <Select
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}
            >
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace('_', ' ')}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Reason</Label>
            <Select
              value={reason}
              onChange={(e) => setReason(e.target.value as HiringRequestReason)}
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Proposed Start Date</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <Label>Justification</Label>
            <Textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="e.g. Existing cashier resigned"
            />
          </div>
        </div>
        <SheetFooter>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!departmentId || !positionId || createMutation.isPending}
          >
            Create Hiring Request
          </Button>
        </SheetFooter>
      </Sheet>
    </main>
  );
}
