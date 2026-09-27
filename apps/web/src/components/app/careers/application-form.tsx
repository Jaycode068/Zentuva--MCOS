'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Input, Label, Select, Textarea } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';
import {
  PublicApplicationAnswer,
  PublicVacancyDetail,
  submitPublicApplication,
} from '@/app/careers/api';

import { ApplicationSuccess } from './application-success';

/**
 * Sprint 30.1 — Public Recruitment Experience & Candidate Application Flow
 * (recruitment.md §"Candidate Application Experience" / §"Custom Application
 * Questions"). Uses the existing Sprint 30 public application architecture
 * exactly as-is (`submitPublicApplication`) — no second form/question
 * system. Server-side validation (`CareersService.submitApplication`)
 * remains authoritative; this form's own required-field checks are a UX
 * convenience only.
 */
export function ApplicationForm({
  vacancy,
  organisationName,
  organisationSlug,
  vacancySlug,
}: {
  vacancy: PublicVacancyDetail;
  organisationName: string;
  organisationSlug: string;
  vacancySlug: string;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [coverLetterText, setCoverLetterText] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const submitMutation = useMutation({
    mutationFn: () => {
      const answerPayload: PublicApplicationAnswer[] = vacancy.questions.map((q) => {
        const raw = answers[q.id] ?? '';
        if (q.type === 'NUMBER') {
          return { vacancyQuestionId: q.id, answerNumber: raw ? Number(raw) : undefined };
        }
        if (q.type === 'YES_NO') {
          return { vacancyQuestionId: q.id, answerBoolean: raw === 'yes' };
        }
        return { vacancyQuestionId: q.id, answerText: raw || undefined };
      });
      return submitPublicApplication(
        organisationSlug,
        vacancySlug,
        {
          firstName,
          lastName,
          email,
          phone: phone || undefined,
          location: location || undefined,
          coverLetterText: coverLetterText || undefined,
          answers: answerPayload,
        },
        resumeFile ?? undefined,
      );
    },
  });

  if (submitMutation.isSuccess) {
    return (
      <ApplicationSuccess
        vacancyTitle={vacancy.title}
        organisationName={organisationName}
        organisationSlug={organisationSlug}
      />
    );
  }

  const requiredMissing =
    !firstName.trim() ||
    !lastName.trim() ||
    !email.trim() ||
    vacancy.questions.some((q) => q.required && !answers[q.id]?.trim());

  return (
    <div>
      <a
        href={`/careers/${organisationSlug}/${vacancySlug}`}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← {vacancy.title}
      </a>
      <h1 className="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">
        Apply for {vacancy.title}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">at {organisationName}</p>

      <form
        className="mt-6 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          submitMutation.mutate();
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="firstName">First Name *</Label>
            <Input
              id="firstName"
              className="mt-1.5"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="lastName">Last Name *</Label>
            <Input
              id="lastName"
              className="mt-1.5"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
          </div>
        </div>

        <div>
          <Label htmlFor="email">Email *</Label>
          <Input
            id="email"
            type="email"
            className="mt-1.5"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              className="mt-1.5"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              className="mt-1.5"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="resume">Resume/CV (PDF, DOC, or DOCX)</Label>
          <input
            id="resume"
            type="file"
            accept=".pdf,.doc,.docx"
            className="mt-1.5 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground"
            onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <div>
          <Label htmlFor="coverLetter">Cover Letter</Label>
          <Textarea
            id="coverLetter"
            className="mt-1.5"
            rows={4}
            value={coverLetterText}
            onChange={(e) => setCoverLetterText(e.target.value)}
          />
        </div>

        {vacancy.questions.map((q) => (
          <div key={q.id}>
            <Label htmlFor={`question-${q.id}`}>
              {q.label} {q.required ? '*' : ''}
            </Label>
            {q.type === 'YES_NO' ? (
              <Select
                id={`question-${q.id}`}
                className="mt-1.5"
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              >
                <option value="">Select…</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            ) : q.type === 'NUMBER' ? (
              <Input
                id={`question-${q.id}`}
                type="number"
                className="mt-1.5"
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              />
            ) : q.type === 'FILE' ? (
              <Input
                id={`question-${q.id}`}
                type="text"
                placeholder="Link to your file (e.g. portfolio URL)"
                className="mt-1.5"
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              />
            ) : (
              <Textarea
                id={`question-${q.id}`}
                className="mt-1.5"
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              />
            )}
          </div>
        ))}

        {submitMutation.isError && (
          <p className="text-sm text-destructive" role="alert">
            {submitMutation.error instanceof ApiError
              ? submitMutation.error.message
              : 'Failed to submit application. Please try again.'}
          </p>
        )}

        <Button
          type="submit"
          size="touch"
          disabled={requiredMissing || submitMutation.isPending}
          className="w-full"
        >
          {submitMutation.isPending ? 'Submitting…' : 'Submit Application'}
        </Button>
      </form>
    </div>
  );
}
