'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { Button, Textarea } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import { InterviewRecommendation, getMyInterview, submitMyEvaluation } from '../api';

const RECOMMENDATIONS: { value: InterviewRecommendation; label: string }[] = [
  { value: 'PROCEED', label: 'Proceed' },
  { value: 'RECOMMEND_HIRE', label: 'Recommend Hire' },
  { value: 'HOLD', label: 'Hold' },
  { value: 'REJECT', label: 'Reject' },
  { value: 'RECOMMEND_REJECT', label: 'Recommend Reject' },
];

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Mobile" / §"Interview Evaluation"). The core mobile
 * flow: open notification → see interview → open candidate → enter score →
 * select recommendation → add comment → submit. Verified at 375px.
 */
export default function MyInterviewDetailPage() {
  const params = useParams<{ id: string }>();
  const interviewId = params.id;
  const queryClient = useQueryClient();
  const [score, setScore] = useState<number | null>(null);
  const [recommendation, setRecommendation] = useState<InterviewRecommendation | null>(null);
  const [comments, setComments] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-interview', interviewId],
    queryFn: () => getMyInterview(interviewId),
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      submitMyEvaluation(interviewId, {
        score: score!,
        recommendation: recommendation!,
        comments: comments || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-interview', interviewId] });
      queryClient.invalidateQueries({ queryKey: ['my-interview-evaluations'] });
    },
  });

  if (isLoading) {
    return <main className="mx-auto max-w-lg px-4 py-8 sm:px-6">Loading…</main>;
  }
  if (isError || !data) {
    return (
      <main className="mx-auto max-w-lg px-4 py-8 text-center sm:px-6">
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load this interview.'}
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
          Retry
        </Button>
      </main>
    );
  }

  const { interview, ownEvaluation } = data;

  return (
    <main className="mx-auto max-w-lg px-4 py-8 sm:px-6">
      <a href="/hr-interviews" className="text-sm text-muted-foreground">
        ← My Evaluations
      </a>

      <div className="mt-3 rounded-lg border border-border p-4">
        <h1 className="text-lg font-semibold">
          {interview.application.candidate.firstName} {interview.application.candidate.lastName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{interview.application.vacancy.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">Stage: {interview.interviewStage.name}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {interview.scheduledAt
            ? new Date(interview.scheduledAt).toLocaleString()
            : 'Not yet scheduled'}
        </p>
        {interview.location && (
          <p className="mt-1 text-sm text-muted-foreground">{interview.location}</p>
        )}
      </div>

      {ownEvaluation ? (
        <div className="mt-4 rounded-lg border border-border bg-secondary/50 p-4">
          <p className="text-sm font-medium">Your evaluation has been submitted.</p>
          <p className="mt-2 text-sm">Score: {ownEvaluation.score} / 5</p>
          <p className="text-sm">
            Recommendation:{' '}
            {RECOMMENDATIONS.find((r) => r.value === ownEvaluation.recommendation)?.label}
          </p>
          {ownEvaluation.comments && (
            <p className="mt-2 text-sm text-muted-foreground">
              &ldquo;{ownEvaluation.comments}&rdquo;
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Submitted {new Date(ownEvaluation.submittedAt).toLocaleString()}. Evaluations are
            immutable — contact HR if this needs to be reopened.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          <div>
            <p className="mb-2 text-sm font-medium">Score</p>
            <div className="flex justify-between gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setScore(n)}
                  className={`h-14 flex-1 rounded-lg border text-lg font-semibold transition-colors ${
                    score === n
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">1 = Poor · 5 = Excellent</p>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Recommendation</p>
            <div className="grid grid-cols-1 gap-2">
              {RECOMMENDATIONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRecommendation(r.value)}
                  className={`rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors ${
                    recommendation === r.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Comments (optional)</p>
            <Textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={4} />
          </div>

          <Button
            className="w-full"
            size="touch"
            disabled={!score || !recommendation || submitMutation.isPending}
            onClick={() => submitMutation.mutate()}
          >
            Submit Evaluation
          </Button>
          {submitMutation.isError && (
            <p className="text-sm text-destructive">
              {submitMutation.error instanceof ApiError
                ? submitMutation.error.message
                : 'Failed to submit evaluation.'}
            </p>
          )}
        </div>
      )}
    </main>
  );
}
