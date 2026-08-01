'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Checkbox, Input, Label, buttonVariants, cn } from '@zentuva/ui';
import { loginSchema, type LoginInput } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { AuthShell } from '@/components/auth/auth-shell';
import { PasswordInput } from '@/components/auth/password-input';
import { ApiError, setTokens } from '@/lib/api-client';
import { login } from '@/lib/auth';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justResetPassword = searchParams.get('passwordReset') === '1';
  const [rememberMe, setRememberMe] = useState(true);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: LoginInput) => login(values),
    onSuccess: (result) => {
      setTokens(result.accessToken, result.refreshToken, rememberMe);
      // Sprint 3.3 §5 "First Login Password Change" — a forced password change takes
      // priority over the normal landing page.
      router.push(result.user.mustChangePassword ? '/change-password' : '/settings/organisation');
    },
  });

  const errors = form.formState.errors;

  return (
    <AuthShell maxWidthClassName="max-w-md">
      <div className="rounded-2xl border border-border bg-card p-8 shadow-sm sm:p-10">
        <div className="mb-8 text-center">
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-brandPurple">
            Welcome back
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Sign in to your Zentuva workspace.</p>
        </div>

        {justResetPassword && (
          <p className="mb-6 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-center text-sm text-primary">
            Your password has been updated. Sign in with your new password.
          </p>
        )}

        <form
          noValidate
          className="space-y-4"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoFocus {...form.register('email')} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <a
                href="/login/forgot-password"
                className="text-xs font-medium text-primary hover:underline"
              >
                Forgot password?
              </a>
            </div>
            <PasswordInput id="password" {...form.register('password')} />
            {errors.password && (
              <p className="text-xs text-destructive">{errors.password.message}</p>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
            />
            Remember me on this device
          </label>

          {mutation.isError && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {mutation.error instanceof ApiError
                ? mutation.error.message
                : 'Something went wrong signing you in. Please try again.'}
            </p>
          )}

          <button
            type="submit"
            disabled={mutation.isPending}
            className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
          >
            {mutation.isPending ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          New to Zentuva?{' '}
          <a href="/register" className="font-medium text-primary hover:underline">
            Create an organisation
          </a>
        </p>
      </div>
    </AuthShell>
  );
}
