'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Input, Label, buttonVariants, cn } from '@zentuva/ui';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { AuthShell } from '@/components/auth/auth-shell';
import { requestPasswordReset } from '@/lib/auth';

export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: ForgotPasswordInput) => requestPasswordReset(values.email),
    onSuccess: () => setSubmitted(true),
  });

  const errors = form.formState.errors;

  return (
    <AuthShell maxWidthClassName="max-w-md">
      <div className="rounded-2xl border border-border bg-card p-8 shadow-sm sm:p-10">
        <div className="mb-8 text-center">
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-brandPurple">
            Reset your password
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter your email and we&apos;ll send you a link to reset it.
          </p>
        </div>

        {submitted ? (
          <p className="rounded-lg border border-border bg-lavender/50 px-4 py-3 text-center text-sm text-lavender-foreground">
            If an account exists for that email, a password reset link is on its way.
          </p>
        ) : (
          <form
            noValidate
            className="space-y-4"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          >
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...form.register('email')} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>

            <button
              type="submit"
              disabled={mutation.isPending}
              className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
            >
              {mutation.isPending ? 'Sending…' : 'Send Reset Link'}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          <a href="/login" className="font-medium text-primary hover:underline">
            ← Back to Sign In
          </a>
        </p>
      </div>
    </AuthShell>
  );
}
