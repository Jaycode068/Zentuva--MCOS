'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Textarea } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import {
  LocationCapture,
  getMyAttendance,
  requestAttendanceCorrection,
  signIn as signInRequest,
  signOut as signOutRequest,
} from '@/app/(app)/settings/hr/api';
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_VARIANT,
} from '@/app/(app)/settings/hr/labels';

type LocationState =
  | { status: 'idle' }
  | { status: 'capturing' }
  | { status: 'captured'; location: LocationCapture }
  | { status: 'unavailable' }
  | { status: 'denied' };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Wraps the browser Geolocation API in a promise with a short timeout —
 *  never blocks sign-in/out on location, and never fabricates a location
 *  when permission is denied or the API is unavailable (brief §6.3). */
function captureLocation(): Promise<LocationState> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ status: 'unavailable' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          status: 'captured',
          location: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
          },
        });
      },
      (geoError) => {
        resolve(
          geoError.code === geoError.PERMISSION_DENIED
            ? { status: 'denied' }
            : { status: 'unavailable' },
        );
      },
      { timeout: 8000, maximumAge: 60000 },
    );
  });
}

export default function AttendancePage() {
  const queryClient = useQueryClient();
  const [locationState, setLocationState] = useState<LocationState>({ status: 'idle' });
  const [correctionOpenFor, setCorrectionOpenFor] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['my-attendance'],
    queryFn: () => getMyAttendance(),
  });

  const today = todayIso();
  const items = data?.items ?? [];
  const todayRecord = items.find((record) => record.attendanceDate.slice(0, 10) === today);

  const signInMutation = useMutation({
    mutationFn: async () => {
      setLocationState({ status: 'capturing' });
      const captured = await captureLocation();
      setLocationState(captured);
      return signInRequest(captured.status === 'captured' ? captured.location : undefined);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-attendance'] }),
  });

  const signOutMutation = useMutation({
    mutationFn: async () => {
      setLocationState({ status: 'capturing' });
      const captured = await captureLocation();
      setLocationState(captured);
      return signOutRequest(captured.status === 'captured' ? captured.location : undefined);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-attendance'] }),
  });

  let primaryAction: 'SIGN_IN' | 'SIGN_OUT' | 'COMPLETED' | 'REQUIRES_CORRECTION' = 'SIGN_IN';
  if (todayRecord?.reviewStatus === 'REQUIRES_CORRECTION') {
    primaryAction = 'REQUIRES_CORRECTION';
  } else if (todayRecord?.signInAt && todayRecord?.signOutAt) {
    primaryAction = 'COMPLETED';
  } else if (todayRecord?.signInAt) {
    primaryAction = 'SIGN_OUT';
  }

  return (
    <div className="px-4 py-6">
      <h1 className="text-xl font-semibold tracking-tight">Today</h1>
      <p className="text-sm text-muted-foreground" suppressHydrationWarning>
        {new Date().toLocaleDateString()}
      </p>

      <div className="mt-6 rounded-lg border border-border p-4">
        {todayRecord ? (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Sign-in</span>
              <span>{formatTime(todayRecord.signInAt)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Sign-out</span>
              <span>{formatTime(todayRecord.signOutAt)}</span>
            </div>
            <div className="mt-2">
              <Badge variant={ATTENDANCE_STATUS_VARIANT[todayRecord.status]}>
                {ATTENDANCE_STATUS_LABELS[todayRecord.status]}
              </Badge>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">You haven&apos;t signed in today yet.</p>
        )}

        <div className="mt-4">
          {primaryAction === 'SIGN_IN' && (
            <Button
              className="w-full"
              disabled={signInMutation.isPending}
              onClick={() => signInMutation.mutate()}
            >
              {signInMutation.isPending ? 'Signing in…' : 'Sign In'}
            </Button>
          )}
          {primaryAction === 'SIGN_OUT' && (
            <Button
              className="w-full"
              disabled={signOutMutation.isPending}
              onClick={() => signOutMutation.mutate()}
            >
              {signOutMutation.isPending ? 'Signing out…' : 'Sign Out'}
            </Button>
          )}
          {primaryAction === 'COMPLETED' && (
            <Button className="w-full" variant="outline" disabled>
              Completed
            </Button>
          )}
          {primaryAction === 'REQUIRES_CORRECTION' && (
            <Button
              className="w-full"
              variant="outline"
              onClick={() => setCorrectionOpenFor(todayRecord!.id)}
            >
              Requires Correction — Request Fix
            </Button>
          )}
        </div>

        <LocationStatus state={locationState} />

        {(signInMutation.isError || signOutMutation.isError) && (
          <p className="mt-2 text-sm text-destructive">
            {(signInMutation.error ?? signOutMutation.error) instanceof ApiError
              ? (signInMutation.error ?? signOutMutation.error)!.message
              : 'That action could not be completed.'}
          </p>
        )}

        <p className="mt-3 text-xs text-muted-foreground">
          Times are recorded by the server, shown in your device&apos;s local time. Location is only
          used if you allow it — it is never required and never guessed.
        </p>
      </div>

      <h2 className="mb-2 mt-8 text-sm font-semibold">History</h2>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load attendance history.'}
        </p>
      )}
      <div className="space-y-2">
        {items.map((record) => (
          <div key={record.id} className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {new Date(record.attendanceDate).toLocaleDateString()}
              </span>
              <Badge variant={ATTENDANCE_STATUS_VARIANT[record.status]}>
                {ATTENDANCE_STATUS_LABELS[record.status]}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatTime(record.signInAt)} – {formatTime(record.signOutAt)}
            </p>
            {record.id !== todayRecord?.id && (
              <button
                type="button"
                className="mt-2 text-xs text-primary"
                onClick={() => setCorrectionOpenFor(record.id)}
              >
                Request a correction
              </button>
            )}
            {correctionOpenFor === record.id && (
              <CorrectionForm
                attendanceRecordId={record.id}
                onClose={() => setCorrectionOpenFor(null)}
                onSubmitted={() => {
                  setCorrectionOpenFor(null);
                  queryClient.invalidateQueries({ queryKey: ['my-attendance'] });
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function LocationStatus({ state }: { state: LocationState }) {
  if (state.status === 'idle') return null;
  const text: Record<LocationState['status'], string> = {
    idle: '',
    capturing: 'Requesting your location…',
    captured: 'Location captured.',
    unavailable: 'Location unavailable — recorded without it.',
    denied: 'Location permission denied — recorded without it.',
  };
  return <p className="mt-2 text-xs text-muted-foreground">{text[state.status]}</p>;
}

function CorrectionForm({
  attendanceRecordId,
  onClose,
  onSubmitted,
}: {
  attendanceRecordId: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () => requestAttendanceCorrection(attendanceRecordId, { reason: reason.trim() }),
    onSuccess: onSubmitted,
  });

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <Textarea
        rows={2}
        placeholder="What needs to be corrected?"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {mutation.isError && (
        <p className="text-xs text-destructive">
          {mutation.error instanceof ApiError
            ? mutation.error.message
            : 'Failed to submit request.'}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={reason.trim().length === 0 || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Submit
        </Button>
      </div>
    </div>
  );
}
