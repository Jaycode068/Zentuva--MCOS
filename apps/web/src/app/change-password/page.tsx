'use client';

import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { buttonVariants, cn, Label } from '@zentuva/ui';
import { changePasswordSchema, type ChangePasswordInput } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { AuthShell } from '@/components/auth/auth-shell';
import { PasswordInput } from '@/components/auth/password-input';
import { PasswordStrength } from '@/components/auth/password-strength';
import { changePassword } from '@/lib/account';
import { ApiError } from '@/lib/api-client';

/**
 * Standalone `/change-password` page (Sprint 3.3 §2), reused for two entry points:
 * voluntary changes from `/account/security`, and the forced first-login redirect
 * (`AuthenticatedNav`'s `mustChangePassword` guard, §5) — both post the same
 * `POST /api/account/change-password` request and land back on `/settings/organisation`
 * on success ("Continue normally", per the brief). `POST /account/change-password` keeps
 * the current session signed in (it only revokes *other* sessions), so no re-login is
 * needed after a successful change.
 */
export default function ChangePasswordPage() {
  const router = useRouter();

  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: ChangePasswordInput) => changePassword(values),
    onSuccess: () => {
      router.push('/settings/organisation');
    },
  });

  const errors = form.formState.errors;
  const newPassword = form.watch('newPassword');

  return (
    <AuthShell maxWidthClassName="max-w-md">
      <div className="rounded-2xl border border-border bg-card p-8 shadow-sm sm:p-10">
        <div className="mb-8 text-center">
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-brandPurple">
            Change your password
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Keep your account secure with a strong, unique password.
          </p>
        </div>

        <form
          noValidate
          className="space-y-4"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <div className="space-y-1.5">
            <Label htmlFor="currentPassword">Current Password</Label>
            <PasswordInput id="currentPassword" autoFocus {...form.register('currentPassword')} />
            {errors.currentPassword && (
              <p className="text-xs text-destructive">{errors.currentPassword.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="newPassword">New Password</Label>
            <PasswordInput id="newPassword" {...form.register('newPassword')} />
            {errors.newPassword && (
              <p className="text-xs text-destructive">{errors.newPassword.message}</p>
            )}
            <PasswordStrength password={newPassword} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <PasswordInput id="confirmPassword" {...form.register('confirmPassword')} />
            {errors.confirmPassword && (
              <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
            )}
          </div>

          <p className="rounded-lg border border-border bg-lavender/50 px-4 py-3 text-xs text-lavender-foreground">
            Changing your password signs you out of every other device. This device stays signed in.
          </p>

          {mutation.isError && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {mutation.error instanceof ApiError
                ? mutation.error.message
                : 'Something went wrong changing your password. Please try again.'}
            </p>
          )}

          <button
            type="submit"
            disabled={mutation.isPending}
            className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
          >
            {mutation.isPending ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
