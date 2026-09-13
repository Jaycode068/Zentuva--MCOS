'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Dialog,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
} from '@zentuva/ui';

import { HrTabs } from '@/components/app/hr-tabs';
import { ApiError } from '@/lib/api-client';

import {
  AttendanceRecord,
  administrativeAttendanceEntry,
  listAttendance,
  listDepartments,
  listEmployees,
} from '../api';
import {
  ATTENDANCE_REVIEW_STATUS_LABELS,
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_VARIANT,
} from '../labels';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AttendancePage() {
  const [date, setDate] = useState(todayIso());
  const [departmentId, setDepartmentId] = useState('');
  const [reviewStatus, setReviewStatus] = useState('');
  const [adminEntryOpen, setAdminEntryOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: departmentsData } = useQuery({
    queryKey: ['hr-departments-lite'],
    queryFn: () => listDepartments(),
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['hr-attendance', date, departmentId, reviewStatus],
    queryFn: () =>
      listAttendance({
        dateFrom: date,
        dateTo: date,
        departmentId: departmentId || undefined,
        reviewStatus: (reviewStatus || undefined) as never,
        pageSize: 100,
      }),
  });

  const records = data?.items ?? [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Human Resources</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Daily attendance — sign-in/out, review, and corrections.
          </p>
        </div>
        <Button onClick={() => setAdminEntryOpen(true)}>Record Attendance</Button>
      </div>

      <HrTabs />

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Department</Label>
          <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">All departments</option>
            {(departmentsData?.items ?? []).map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Review Status</Label>
          <Select value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)}>
            <option value="">All</option>
            <option value="NOT_REVIEWED">Not Reviewed</option>
            <option value="APPROVED">Approved</option>
            <option value="REQUIRES_CORRECTION">Requires Correction</option>
            <option value="REJECTED">Rejected</option>
          </Select>
        </div>
      </div>

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading attendance…</p>
      )}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load attendance.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && records.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No attendance records for this date.
        </p>
      )}

      {!isLoading && !isError && records.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Sign In</th>
                  <th className="px-4 py-3">Sign Out</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Review</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <AttendanceRow key={record.id} record={record} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {records.map((record) => (
              <a
                key={record.id}
                href={`/settings/hr/attendance/${record.id}`}
                className="block rounded-lg border border-border p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {record.employee?.firstName} {record.employee?.lastName}
                  </span>
                  <Badge variant={ATTENDANCE_STATUS_VARIANT[record.status]}>
                    {ATTENDANCE_STATUS_LABELS[record.status]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatTime(record.signInAt)} – {formatTime(record.signOutAt)} ·{' '}
                  {ATTENDANCE_REVIEW_STATUS_LABELS[record.reviewStatus]}
                </p>
              </a>
            ))}
          </div>
        </>
      )}

      {adminEntryOpen && (
        <AdministrativeEntryDialog
          date={date}
          onClose={() => setAdminEntryOpen(false)}
          onSaved={() => {
            setAdminEntryOpen(false);
            queryClient.invalidateQueries({ queryKey: ['hr-attendance'] });
          }}
        />
      )}
    </main>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function AttendanceRow({ record }: { record: AttendanceRecord }) {
  const hasLocation = Boolean(record.signInLocationLabel || record.signInLatitude);
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">
        <a href={`/settings/hr/attendance/${record.id}`} className="font-medium hover:underline">
          {record.employee?.firstName} {record.employee?.lastName}
        </a>
        <p className="text-xs text-muted-foreground">{record.employee?.employeeCode}</p>
      </td>
      <td className="px-4 py-3">{formatTime(record.signInAt)}</td>
      <td className="px-4 py-3">{formatTime(record.signOutAt)}</td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {record.source === 'ADMINISTRATIVE'
          ? 'Administrative — no location'
          : hasLocation
            ? (record.signInLocationLabel ?? 'Captured')
            : 'Not captured'}
      </td>
      <td className="px-4 py-3">
        <Badge variant={ATTENDANCE_STATUS_VARIANT[record.status]}>
          {ATTENDANCE_STATUS_LABELS[record.status]}
        </Badge>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {ATTENDANCE_REVIEW_STATUS_LABELS[record.reviewStatus]}
      </td>
      <td className="px-4 py-3 text-right">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            window.location.href = `/settings/hr/attendance/${record.id}`;
          }}
        >
          View
        </Button>
      </td>
    </tr>
  );
}

function AdministrativeEntryDialog({
  date,
  onClose,
  onSaved,
}: {
  date: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [attendanceDate, setAttendanceDate] = useState(date);
  const [signIn, setSignIn] = useState(true);
  const [signOut, setSignOut] = useState(false);
  const [notes, setNotes] = useState('');

  const { data: employeesData } = useQuery({
    queryKey: ['hr-employees', 'for-attendance'],
    queryFn: () => listEmployees({ pageSize: 100, employmentStatus: 'ACTIVE' }),
  });
  const employees = useMemo(() => employeesData?.items ?? [], [employeesData]);

  const mutation = useMutation({
    mutationFn: () =>
      administrativeAttendanceEntry({
        employeeId,
        attendanceDate,
        signIn,
        signOut,
        notes: notes.trim() || undefined,
      }),
    onSuccess: onSaved,
  });

  const canSubmit = employeeId.length > 0 && attendanceDate.length > 0 && (signIn || signOut);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogHeader>
        <DialogTitle>Record Attendance</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) mutation.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label>Employee</Label>
          <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Select an employee</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.employeeCode} — {employee.firstName} {employee.lastName}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Date</Label>
          <Input
            type="date"
            value={attendanceDate}
            max={todayIso()}
            onChange={(e) => setAttendanceDate(e.target.value)}
          />
        </div>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={signIn} onChange={(e) => setSignIn(e.target.checked)} />
            Sign in
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={signOut}
              onChange={(e) => setSignOut(e.target.checked)}
            />
            Sign out
          </label>
        </div>
        <div className="space-y-1.5">
          <Label>Notes</Label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Device unavailable — recorded by HR"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          No location is captured for administrative entries. Timestamps use the current server
          time.
        </p>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to record attendance.'}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
