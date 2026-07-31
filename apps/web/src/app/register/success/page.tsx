'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { buttonVariants } from '@zentuva/ui';

import { AuthShell } from '@/components/auth/auth-shell';

export default function RegisterSuccessPage() {
  return (
    <Suspense>
      <RegisterSuccessContent />
    </Suspense>
  );
}

function RegisterSuccessContent() {
  const searchParams = useSearchParams();
  const organisationName = searchParams.get('name');
  const organisationCode = searchParams.get('code');
  const ownerEmail = searchParams.get('email');

  return (
    <AuthShell maxWidthClassName="max-w-lg">
      <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm sm:p-12">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <svg
            viewBox="0 0 24 24"
            className="h-7 w-7"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <h1 className="mt-6 text-balance text-2xl font-semibold tracking-tight text-brandPurple">
          Your organisation is ready
        </h1>
        <p className="mt-2 text-muted-foreground">
          {organisationName ?? 'Your organisation'} has been created. You can now sign in with the
          Owner account you just set up.
        </p>

        <dl className="mt-8 space-y-3 rounded-xl bg-lavender/50 p-5 text-left">
          <SummaryRow label="Organisation Name" value={organisationName} />
          <SummaryRow label="Organisation Code" value={organisationCode} />
          <SummaryRow label="Owner Email" value={ownerEmail} />
        </dl>

        <a href="/login" className={buttonVariants({ size: 'lg', className: 'mt-8 w-full' })}>
          Continue to Login
        </a>
      </div>
    </AuthShell>
  );
}

function SummaryRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-sm text-lavender-foreground/70">{label}</dt>
      <dd className="text-sm font-semibold text-lavender-foreground">{value ?? '—'}</dd>
    </div>
  );
}
