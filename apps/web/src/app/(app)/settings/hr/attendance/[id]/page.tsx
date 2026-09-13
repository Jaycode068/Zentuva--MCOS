'use client';

import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Textarea } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import { getAttendanceRecord, reviewAttendance, reviewAttendanceCorrection } from '../../api';
import {
  ATTENDANCE_CORRECTION_STATUS_LABELS,
  ATTENDANCE_CORRECTION_STATUS_VARIANT,
  ATTENDANCE_REVIEW_STATUS_LABELS,
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_VARIANT,
} from '../../labels';
import { useState } from 'react';

export default function AttendanceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();
  const [reviewNotes, setReviewNotes] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['hr-attendance-detail', id],
    queryFn: () => getAttendanceRecord(id),
  });

  const reviewMutation = useMutation({
    mutationFn: (reviewStatus: 'APPROVED' | 'REQUIRES_CORRECTION' | 'REJECTED') =>
      reviewAttendance(id, { reviewStatus, notes: reviewNotes.trim() || undefined }),
    onSuccess: () => {
      refetch();
      queryClient.invalidateQueries({ queryKey: ['hr-attendance'] });
    },
  });

  const correctionMutation = useMutation({
    mutationFn: ({
      correctionId,
      decision,
    }: {
      correctionId: string;
      decision: 'APPROVED' | 'REJECTED';
    }) => reviewAttendanceCorrection(correctionId, { decision }),
    onSuccess: () => {
      refetch();
      queryClient.invalidateQueries({ queryKey: ['hr-attendance'] });
    },
  });

  if (isLoading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="text-center text-sm text-muted-foreground">Loading attendance record…</p>
      </main>
    );
  }
  if (isError || !data) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load attendance record.'}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <a href="/settings/hr/attendance" className="text-sm text-muted-foreground hover:underline">
        ← Back to Attendance
      </a>

      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          {data.employee?.firstName} {data.employee?.lastName}
        </h1>
        <Badge variant={ATTENDANCE_STATUS_VARIANT[data.status]}>
          {ATTENDANCE_STATUS_LABELS[data.status]}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {new Date(data.attendanceDate).toLocaleDateString()} · {data.employee?.employeeCode}
      </p>

      <Section title="Sign In / Sign Out">
        <Field label="Sign-in time" value={formatDateTime(data.signInAt)} />
        <Field
          label="Sign-in location"
          value={
            data.signInLocationLabel ??
            (data.signInLatitude
              ? `${data.signInLatitude}, ${data.signInLongitude}`
              : 'Not captured')
          }
        />
        <Field label="Sign-out time" value={formatDateTime(data.signOutAt)} />
        <Field
          label="Sign-out location"
          value={
            data.signOutLocationLabel ??
            (data.signOutLatitude
              ? `${data.signOutLatitude}, ${data.signOutLongitude}`
              : 'Not captured')
          }
        />
        <Field
          label="Source"
          value={data.source === 'ADMINISTRATIVE' ? 'Administrative' : 'Self-service'}
        />
        <Field label="Notes" value={data.notes ?? '—'} />
      </Section>

      <Section title="Review">
        <p className="mb-3 text-sm text-muted-foreground">
          Current review status:{' '}
          <strong>{ATTENDANCE_REVIEW_STATUS_LABELS[data.reviewStatus]}</strong>
        </p>
        <Textarea
          rows={2}
          placeholder="Optional review notes"
          value={reviewNotes}
          onChange={(e) => setReviewNotes(e.target.value)}
          className="mb-3"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={reviewMutation.isPending}
            onClick={() => reviewMutation.mutate('APPROVED')}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={reviewMutation.isPending}
            onClick={() => reviewMutation.mutate('REQUIRES_CORRECTION')}
          >
            Requires Correction
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={reviewMutation.isPending}
            onClick={() => reviewMutation.mutate('REJECTED')}
          >
            Reject
          </Button>
        </div>
        {reviewMutation.isError && (
          <p className="mt-2 text-sm text-destructive">
            {reviewMutation.error instanceof ApiError
              ? reviewMutation.error.message
              : 'Failed to update review status.'}
          </p>
        )}
      </Section>

      <Section title="Correction Requests">
        {data.corrections.length === 0 && (
          <p className="text-sm text-muted-foreground">No correction requests for this record.</p>
        )}
        <div className="space-y-3">
          {data.corrections.map((correction) => (
            <div key={correction.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <Badge variant={ATTENDANCE_CORRECTION_STATUS_VARIANT[correction.status]}>
                  {ATTENDANCE_CORRECTION_STATUS_LABELS[correction.status]}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(correction.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="mt-2 text-sm">{correction.reason}</p>
              {correction.requestedSignInAt && (
                <p className="text-xs text-muted-foreground">
                  Requested sign-in: {formatDateTime(correction.requestedSignInAt)}
                </p>
              )}
              {correction.requestedSignOutAt && (
                <p className="text-xs text-muted-foreground">
                  Requested sign-out: {formatDateTime(correction.requestedSignOutAt)}
                </p>
              )}
              {correction.status === 'REQUESTED' && (
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    disabled={correctionMutation.isPending}
                    onClick={() =>
                      correctionMutation.mutate({
                        correctionId: correction.id,
                        decision: 'APPROVED',
                      })
                    }
                  >
                    Approve Correction
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={correctionMutation.isPending}
                    onClick={() =>
                      correctionMutation.mutate({
                        correctionId: correction.id,
                        decision: 'REJECTED',
                      })
                    }
                  >
                    Reject
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
        {correctionMutation.isError && (
          <p className="mt-2 text-sm text-destructive">
            {correctionMutation.error instanceof ApiError
              ? correctionMutation.error.message
              : 'Failed to review correction.'}
          </p>
        )}
      </Section>
    </main>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 rounded-lg border border-border p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2 flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
