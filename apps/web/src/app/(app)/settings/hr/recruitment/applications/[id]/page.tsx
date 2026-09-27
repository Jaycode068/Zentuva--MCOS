'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { Badge, Button, Checkbox, Input, Label, Select, Textarea } from '@zentuva/ui';

import { HrTabs } from '@/components/app/hr-tabs';
import { ApiError } from '@/lib/api-client';
import { listUsers } from '../../../../users/api';

import {
  EmploymentType,
  Offer,
  StageDecisionType,
  acceptOffer,
  createOffer,
  declineOffer,
  decideInterviewStage,
  getApplication,
  getInterviewSummary,
  getVacancy,
  issueOffer,
  rejectApplication,
  scheduleInterview,
  screenApplication,
  shortlistApplication,
  withdrawOffer,
} from '../../api';
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_VARIANT,
  OFFER_STATUS_LABELS,
  OFFER_STATUS_VARIANT,
  RECOMMENDATION_LABELS,
} from '../../labels';

function StageSummary({ interviewId }: { interviewId: string }) {
  const { data: summary } = useQuery({
    queryKey: ['recruitment-interview-summary', interviewId],
    queryFn: () => getInterviewSummary(interviewId),
  });
  if (!summary) return null;
  return (
    <div className="mt-2 rounded-md bg-secondary/50 p-3 text-sm">
      <p>
        Evaluators: {summary.evaluatorsAssigned} · Completed: {summary.evaluationsCompleted}
      </p>
      <p>Average Score: {summary.averageScore !== null ? `${summary.averageScore} / 5` : '—'}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {Object.entries(summary.recommendationCounts)
          .map(
            ([rec, count]) =>
              `${RECOMMENDATION_LABELS[rec as keyof typeof RECOMMENDATION_LABELS] ?? rec}: ${count}`,
          )
          .join(' · ') || 'No evaluations submitted yet.'}
      </p>
    </div>
  );
}

export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const applicationId = params.id;
  const queryClient = useQueryClient();
  const [screeningNotes, setScreeningNotes] = useState('');
  const [schedulingStageId, setSchedulingStageId] = useState<string | null>(null);
  const [scheduledAt, setScheduledAt] = useState('');
  const [scheduleParticipants, setScheduleParticipants] = useState<string[]>([]);
  const [offerSalary, setOfferSalary] = useState('');
  const [offerEmploymentType, setOfferEmploymentType] = useState<EmploymentType>('FULL_TIME');
  const [offerStartDate, setOfferStartDate] = useState('');

  const {
    data: application,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['recruitment-application', applicationId],
    queryFn: () => getApplication(applicationId),
  });

  const { data: vacancy } = useQuery({
    queryKey: ['recruitment-vacancy', application?.vacancyId],
    queryFn: () => getVacancy(application!.vacancyId),
    enabled: Boolean(application?.vacancyId),
  });

  const { data: usersData } = useQuery({ queryKey: ['org-users'], queryFn: () => listUsers() });
  const users = usersData?.items ?? [];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['recruitment-application', applicationId] });

  const screenMutation = useMutation({
    mutationFn: () => screenApplication(applicationId, screeningNotes || undefined),
    onSuccess: invalidate,
  });
  const shortlistMutation = useMutation({
    mutationFn: () => shortlistApplication(applicationId, screeningNotes || undefined),
    onSuccess: invalidate,
  });
  const rejectMutation = useMutation({
    mutationFn: () => rejectApplication(applicationId, screeningNotes || undefined),
    onSuccess: invalidate,
  });

  const scheduleMutation = useMutation({
    mutationFn: (stageId: string) =>
      scheduleInterview({
        applicationId,
        interviewStageId: stageId,
        scheduledAt: new Date(scheduledAt).toISOString(),
        participantUserIds: scheduleParticipants,
      }),
    onSuccess: () => {
      invalidate();
      setSchedulingStageId(null);
      setScheduledAt('');
      setScheduleParticipants([]);
    },
  });

  const decideMutation = useMutation({
    mutationFn: (params: { interviewId: string; decision: StageDecisionType }) =>
      decideInterviewStage(params.interviewId, params.decision),
    onSuccess: invalidate,
  });

  const createOfferMutation = useMutation({
    mutationFn: () =>
      createOffer(applicationId, {
        proposedSalary: offerSalary ? Number(offerSalary) : undefined,
        employmentType: offerEmploymentType,
        proposedStartDate: offerStartDate || undefined,
      }),
    onSuccess: invalidate,
  });
  const issueOfferMutation = useMutation({
    mutationFn: (id: string) => issueOffer(id),
    onSuccess: invalidate,
  });
  const acceptOfferMutation = useMutation({
    mutationFn: (id: string) => acceptOffer(id),
    onSuccess: invalidate,
  });
  const declineOfferMutation = useMutation({
    mutationFn: (id: string) => declineOffer(id),
    onSuccess: invalidate,
  });
  const withdrawOfferMutation = useMutation({
    mutationFn: (id: string) => withdrawOffer(id),
    onSuccess: invalidate,
  });

  if (isLoading) {
    return <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">Loading…</main>;
  }
  if (isError || !application) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10 text-center sm:px-6">
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load application.'}
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
          Retry
        </Button>
      </main>
    );
  }

  const stages = (vacancy?.interviewStages ?? []).slice().sort((a, b) => a.sequence - b.sequence);
  const interviewsByStage = new Map(
    (application.interviews ?? []).map((i) => [i.interviewStageId, i]),
  );
  const activeOffer = (application.offers ?? []).find(
    (o: Offer) => o.status === 'DRAFT' || o.status === 'ISSUED',
  );

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {application.candidate?.firstName} {application.candidate?.lastName}
            </h1>
            <Badge variant={APPLICATION_STATUS_VARIANT[application.status]}>
              {APPLICATION_STATUS_LABELS[application.status]}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {application.vacancy?.title} · {application.candidate?.email}
            {application.candidate?.phone ? ` · ${application.candidate.phone}` : ''}
          </p>
        </div>
      </div>

      <HrTabs />

      {(application.status === 'SUBMITTED' || application.status === 'SCREENING') && (
        <section className="mb-6 rounded-lg border border-border p-4">
          <h2 className="mb-2 font-medium">Screening</h2>
          <Textarea
            value={screeningNotes}
            onChange={(e) => setScreeningNotes(e.target.value)}
            placeholder="Internal screening notes (never shown to the candidate)"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => screenMutation.mutate()}>
              Save Notes
            </Button>
            <Button size="sm" onClick={() => shortlistMutation.mutate()}>
              Shortlist
            </Button>
            <Button size="sm" variant="outline" onClick={() => rejectMutation.mutate()}>
              Reject
            </Button>
          </div>
        </section>
      )}

      {application.resumeUrl && (
        <p className="mb-6 text-sm">
          <a
            href={application.resumeUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            View Resume/CV
          </a>
        </p>
      )}

      {application.coverLetterText && (
        <section className="mb-6 rounded-lg border border-border p-4">
          <h2 className="mb-2 font-medium">Cover Letter</h2>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {application.coverLetterText}
          </p>
        </section>
      )}

      {(application.answers ?? []).length > 0 && (
        <section className="mb-6 rounded-lg border border-border p-4">
          <h2 className="mb-2 font-medium">Application Answers</h2>
          <ul className="space-y-2 text-sm">
            {application.answers!.map((a) => (
              <li key={a.id}>
                <span className="font-medium">{a.vacancyQuestion?.label}</span>:{' '}
                {a.answerText ??
                  (a.answerBoolean !== null ? (a.answerBoolean ? 'Yes' : 'No') : a.answerNumber)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-6">
        <h2 className="mb-3 font-medium">Interview Stages</h2>
        <div className="space-y-4">
          {stages.map((stage) => {
            const interview = interviewsByStage.get(stage.id);
            return (
              <div key={stage.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    Stage {stage.sequence} — {stage.name}
                  </span>
                  {interview && (
                    <span className="text-xs text-muted-foreground">
                      {interview.scheduledAt
                        ? new Date(interview.scheduledAt).toLocaleString()
                        : 'Not scheduled'}
                    </span>
                  )}
                </div>

                {!interview && (
                  <div className="mt-3">
                    {schedulingStageId === stage.id ? (
                      <div className="space-y-3 rounded-md bg-secondary/50 p-3">
                        <div>
                          <Label>Date &amp; Time</Label>
                          <Input
                            type="datetime-local"
                            value={scheduledAt}
                            onChange={(e) => setScheduledAt(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label>Participants</Label>
                          <div className="max-h-40 space-y-1 overflow-y-auto">
                            {stage.participants.map((p) => {
                              const u = users.find((user) => user.id === p.userId);
                              return (
                                <label key={p.userId} className="flex items-center gap-2 text-sm">
                                  <Checkbox
                                    checked={scheduleParticipants.includes(p.userId)}
                                    onChange={() =>
                                      setScheduleParticipants((list) =>
                                        list.includes(p.userId)
                                          ? list.filter((id) => id !== p.userId)
                                          : [...list, p.userId],
                                      )
                                    }
                                  />
                                  {u ? `${u.firstName} ${u.lastName}` : p.userId}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={!scheduledAt || scheduleParticipants.length === 0}
                            onClick={() => scheduleMutation.mutate(stage.id)}
                          >
                            Confirm Schedule
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSchedulingStageId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSchedulingStageId(stage.id);
                          setScheduleParticipants(stage.participants.map((p) => p.userId));
                        }}
                      >
                        Schedule Interview
                      </Button>
                    )}
                  </div>
                )}

                {interview && (
                  <>
                    <StageSummary interviewId={interview.id} />
                    {(interview.evaluations ?? []).length > 0 && (
                      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {interview.evaluations!.map((ev) => {
                          const u = users.find((user) => user.id === ev.evaluatorUserId);
                          return (
                            <p key={ev.id}>
                              {u ? `${u.firstName} ${u.lastName}` : ev.evaluatorUserId}: {ev.score}
                              /5 — {RECOMMENDATION_LABELS[ev.recommendation]}
                              {ev.comments ? ` — "${ev.comments}"` : ''}
                            </p>
                          );
                        })}
                      </div>
                    )}
                    {(interview.decisions ?? []).length === 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            decideMutation.mutate({
                              interviewId: interview.id,
                              decision: 'ADVANCE',
                            })
                          }
                        >
                          Advance
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            decideMutation.mutate({ interviewId: interview.id, decision: 'HOLD' })
                          }
                        >
                          Hold
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            decideMutation.mutate({ interviewId: interview.id, decision: 'REJECT' })
                          }
                        >
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm font-medium">
                        Decision: {interview.decisions?.[0]?.decision}
                      </p>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border border-border p-4">
        <h2 className="mb-3 font-medium">Offer</h2>
        {(application.offers ?? []).map((offer) => (
          <div
            key={offer.id}
            className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-secondary/50 p-3"
          >
            <div className="text-sm">
              <Badge variant={OFFER_STATUS_VARIANT[offer.status]}>
                {OFFER_STATUS_LABELS[offer.status]}
              </Badge>
              {offer.proposedSalary && (
                <span className="ml-2">₦{offer.proposedSalary.toLocaleString()}</span>
              )}
            </div>
            <div className="flex gap-2">
              {offer.status === 'DRAFT' && (
                <Button size="sm" onClick={() => issueOfferMutation.mutate(offer.id)}>
                  Issue
                </Button>
              )}
              {offer.status === 'ISSUED' && (
                <>
                  <Button size="sm" onClick={() => acceptOfferMutation.mutate(offer.id)}>
                    Mark Accepted
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => declineOfferMutation.mutate(offer.id)}
                  >
                    Mark Declined
                  </Button>
                </>
              )}
              {(offer.status === 'DRAFT' || offer.status === 'ISSUED') && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => withdrawOfferMutation.mutate(offer.id)}
                >
                  Withdraw
                </Button>
              )}
            </div>
          </div>
        ))}

        {!activeOffer && application.status === 'SELECTED' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Proposed Salary</Label>
                <Input
                  type="number"
                  value={offerSalary}
                  onChange={(e) => setOfferSalary(e.target.value)}
                />
              </div>
              <div>
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={offerStartDate}
                  onChange={(e) => setOfferStartDate(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label>Employment Type</Label>
              <Select
                value={offerEmploymentType}
                onChange={(e) => setOfferEmploymentType(e.target.value as EmploymentType)}
              >
                <option value="FULL_TIME">Full-Time</option>
                <option value="PART_TIME">Part-Time</option>
                <option value="CONTRACT">Contract</option>
              </Select>
            </div>
            <Button size="sm" onClick={() => createOfferMutation.mutate()}>
              Create Offer
            </Button>
          </div>
        )}
        {!activeOffer &&
          application.status !== 'SELECTED' &&
          (application.offers ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Available once all required interview stages have been advanced.
            </p>
          )}
      </section>
    </main>
  );
}
