'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  Sheet,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@zentuva/ui';

import { HrTabs } from '@/components/app/hr-tabs';
import { ApiError } from '@/lib/api-client';
import { listUsers } from '../../../../users/api';

import {
  closeVacancy,
  createInterviewStage,
  getVacancy,
  pauseVacancy,
  publishVacancy,
  replaceInterviewStageParticipants,
} from '../../api';
import { VACANCY_STATUS_LABELS, VACANCY_STATUS_VARIANT } from '../../labels';

export default function VacancyDetailPage() {
  const params = useParams<{ id: string }>();
  const vacancyId = params.id;
  const queryClient = useQueryClient();
  const [stageSheetOpen, setStageSheetOpen] = useState(false);
  const [stageName, setStageName] = useState('');
  const [stageDescription, setStageDescription] = useState('');
  const [stageParticipants, setStageParticipants] = useState<string[]>([]);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);

  const {
    data: vacancy,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['recruitment-vacancy', vacancyId],
    queryFn: () => getVacancy(vacancyId),
  });

  const { data: usersData } = useQuery({
    queryKey: ['org-users'],
    queryFn: () => listUsers(),
  });
  const users = usersData?.items ?? [];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['recruitment-vacancy', vacancyId] });

  const publishMutation = useMutation({
    mutationFn: () => publishVacancy(vacancyId),
    onSuccess: invalidate,
  });
  const pauseMutation = useMutation({
    mutationFn: () => pauseVacancy(vacancyId),
    onSuccess: invalidate,
  });
  const closeMutation = useMutation({
    mutationFn: () => closeVacancy(vacancyId),
    onSuccess: invalidate,
  });

  const nextSequence = (vacancy?.interviewStages?.length ?? 0) + 1;

  const createStageMutation = useMutation({
    mutationFn: () =>
      createInterviewStage(vacancyId, {
        name: stageName,
        description: stageDescription || undefined,
        sequence: nextSequence,
        isRequired: true,
        evaluationRequired: true,
        participantUserIds: stageParticipants,
      }),
    onSuccess: () => {
      invalidate();
      setStageSheetOpen(false);
      setStageName('');
      setStageDescription('');
      setStageParticipants([]);
    },
  });

  const replaceParticipantsMutation = useMutation({
    mutationFn: (params: { stageId: string; participantUserIds: string[] }) =>
      replaceInterviewStageParticipants(params.stageId, params.participantUserIds),
    onSuccess: () => {
      invalidate();
      setEditingStageId(null);
    },
  });

  if (isLoading) {
    return <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">Loading…</main>;
  }
  if (isError || !vacancy) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10 text-center sm:px-6">
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load vacancy.'}
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
          Retry
        </Button>
      </main>
    );
  }

  const toggleParticipant = (userId: string, list: string[], setList: (v: string[]) => void) => {
    setList(list.includes(userId) ? list.filter((id) => id !== userId) : [...list, userId]);
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{vacancy.title}</h1>
            <Badge variant={VACANCY_STATUS_VARIANT[vacancy.status]}>
              {VACANCY_STATUS_LABELS[vacancy.status]}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {vacancy.department?.name ?? 'No department'} · {vacancy.numberOfOpenings} opening(s) ·
            Public URL: /careers/&#123;org&#125;/{vacancy.publicSlug}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(vacancy.status === 'DRAFT' || vacancy.status === 'PAUSED') && (
            <Button size="sm" onClick={() => publishMutation.mutate()}>
              Publish
            </Button>
          )}
          {vacancy.status === 'PUBLISHED' && (
            <Button size="sm" variant="outline" onClick={() => pauseMutation.mutate()}>
              Pause
            </Button>
          )}
          {(vacancy.status === 'PUBLISHED' || vacancy.status === 'PAUSED') && (
            <Button size="sm" variant="outline" onClick={() => closeMutation.mutate()}>
              Close
            </Button>
          )}
          <a
            href={`/settings/hr/recruitment/applications?vacancyId=${vacancy.id}`}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-secondary"
          >
            View Applications
          </a>
        </div>
      </div>

      <HrTabs />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-2 font-medium">About the Role</h2>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {vacancy.description}
            </p>
          </section>
          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-2 font-medium">Responsibilities</h2>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {vacancy.responsibilities}
            </p>
          </section>
          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-2 font-medium">Requirements</h2>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {vacancy.requirements}
            </p>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium">Interview Process</h2>
              <Button size="sm" variant="outline" onClick={() => setStageSheetOpen(true)}>
                Add Stage
              </Button>
            </div>
            <div className="space-y-3">
              {(vacancy.interviewStages ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">No interview stages configured yet.</p>
              )}
              {(vacancy.interviewStages ?? [])
                .slice()
                .sort((a, b) => a.sequence - b.sequence)
                .map((stage) => (
                  <div key={stage.id} className="rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        Stage {stage.sequence} — {stage.name}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingStageId(stage.id);
                          setStageParticipants(stage.participants.map((p) => p.userId));
                        }}
                      >
                        Edit Participants
                      </Button>
                    </div>
                    {stage.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{stage.description}</p>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
                      Participants:{' '}
                      {stage.participants
                        .map((p) => {
                          const u = users.find((user) => user.id === p.userId);
                          return u ? `${u.firstName} ${u.lastName}` : p.userId;
                        })
                        .join(', ') || 'None assigned'}
                    </p>

                    {editingStageId === stage.id && (
                      <div className="mt-3 rounded-md border border-border p-3">
                        <p className="mb-2 text-sm font-medium">Select Participants</p>
                        <div className="max-h-48 space-y-2 overflow-y-auto">
                          {users.map((u) => (
                            <label key={u.id} className="flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={stageParticipants.includes(u.id)}
                                onChange={() =>
                                  toggleParticipant(u.id, stageParticipants, setStageParticipants)
                                }
                              />
                              {u.firstName} {u.lastName} — {u.role ?? 'No role'}
                            </label>
                          ))}
                        </div>
                        <div className="mt-3 flex gap-2">
                          <Button
                            size="sm"
                            onClick={() =>
                              replaceParticipantsMutation.mutate({
                                stageId: stage.id,
                                participantUserIds: stageParticipants,
                              })
                            }
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingStageId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-2 font-medium">Application Questions</h2>
            {(vacancy.questions ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No custom questions configured.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {vacancy.questions!.map((q) => (
                  <li key={q.id}>
                    {q.label} {q.required ? '(required)' : '(optional)'}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-lg border border-border p-4 text-xs text-muted-foreground">
            <p>Employment type: {vacancy.employmentType.replace('_', ' ')}</p>
            <p>Work arrangement: {vacancy.workArrangement.replace('_', ' ')}</p>
            {vacancy.applicationDeadline && (
              <p>Deadline: {new Date(vacancy.applicationDeadline).toLocaleDateString()}</p>
            )}
          </section>
        </div>
      </div>

      <Sheet open={stageSheetOpen} onOpenChange={setStageSheetOpen}>
        <SheetHeader>
          <SheetTitle>Add Interview Stage (Sequence {nextSequence})</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 py-4">
          <div>
            <Label>Stage Name</Label>
            <Input
              value={stageName}
              onChange={(e) => setStageName(e.target.value)}
              placeholder="e.g. Finance Interview"
            />
          </div>
          <div>
            <Label>Description</Label>
            <Input value={stageDescription} onChange={(e) => setStageDescription(e.target.value)} />
          </div>
          <div>
            <Label>Participants</Label>
            <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-border p-2">
              {users.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={stageParticipants.includes(u.id)}
                    onChange={() =>
                      toggleParticipant(u.id, stageParticipants, setStageParticipants)
                    }
                  />
                  {u.firstName} {u.lastName} — {u.role ?? 'No role'}
                </label>
              ))}
            </div>
          </div>
        </div>
        <SheetFooter>
          <Button
            onClick={() => createStageMutation.mutate()}
            disabled={!stageName || createStageMutation.isPending}
          >
            Add Stage
          </Button>
        </SheetFooter>
      </Sheet>
    </main>
  );
}
