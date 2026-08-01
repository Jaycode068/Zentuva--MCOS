'use client';

import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { buttonVariants, cn, Label } from '@zentuva/ui';
import { strongPasswordSchema, z } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { AuthShell } from '@/components/auth/auth-shell';
import { PasswordInput } from '@/components/auth/password-input';
import { PasswordStrength } from '@/components/auth/password-strength';
import { ApiError } from '@/lib/api-client';
import { resetPassword } from '@/lib/auth';

const formSchema = z
  .object({
    newPassword: strongPasswordSchema,
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof formSchema>;

/**
 * Completes the forgot-password flow Sprint 3.2 started (brief §3): reset token → this
 * page → `POST /api/auth/password/reset` (Sprint 1B.2 backend, wired to a frontend page
 * for the first time here) → redirect to `/login`.
 */
export default function ResetPasswordPage({ params }: { params: { token: string } }) {
  const router = useRouter();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => resetPassword(params.token, values.newPassword),
    onSuccess: () => {
      router.push('/login?passwordReset=1');
    },
  });

  const errors = form.formState.errors;
  const newPassword = form.watch('newPassword');

  return (
    <AuthShell maxWidthClassName="max-w-md">
      <div className="rounded-2xl border border-border bg-card p-8 shadow-sm sm:p-10">
        <div className="mb-8 text-center">
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-brandPurple">
            Set a new password
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Choose a strong password for your Zentuva account.
          </p>
        </div>

        <form
          noValidate
          className="space-y-4"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">New Password</Label>
            <PasswordInput id="newPassword" autoFocus {...form.register('newPassword')} />
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

          {mutation.isError && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {mutation.error instanceof ApiError
                ? mutation.error.message
                : 'That reset link is invalid or has expired. Request a new one.'}
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

        <p className="mt-6 text-center text-sm text-muted-foreground">
          <a href="/login/forgot-password" className="font-medium text-primary hover:underline">
            Request a new reset link
          </a>
        </p>
      </div>
    </AuthShell>
  );
}
