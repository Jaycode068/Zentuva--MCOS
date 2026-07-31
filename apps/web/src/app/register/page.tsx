'use client';

import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  buttonVariants,
  cn,
} from '@zentuva/ui';
import { z } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { AuthShell } from '@/components/auth/auth-shell';
import { ApiError } from '@/lib/api-client';
import { registerOrganisation } from '@/lib/auth';

/**
 * Mirrors `@zentuva/validation`'s `registerOrganisationSchema` constraints, but every
 * optional field also accepts `''` — form inputs represent "not filled in" as an empty
 * string, while the API schema represents "not provided" by omitting the key. The two
 * are reconciled in the mutation below (empty strings are dropped before the request is
 * sent), the same pattern used by the Organisation Settings form (Sprint 2.1).
 */
const formSchema = z
  .object({
    organisationName: z.string().trim().min(1, 'Organisation name is required').max(200),
    displayName: z.string().trim().max(200).or(z.literal('')),
    industry: z.string().trim().max(100).or(z.literal('')),
    country: z.string().trim().min(2, 'Country is required').max(100),
    state: z.string().trim().max(100).or(z.literal('')),
    city: z.string().trim().max(100).or(z.literal('')),
    phoneNumber: z
      .string()
      .trim()
      .max(30)
      .or(z.literal(''))
      .refine((value) => value === '' || value.length >= 7, 'Phone number is too short'),
    businessEmail: z.string().trim().email('Enter a valid email address').or(z.literal('')),
    website: z.string().trim().url('Enter a valid URL, e.g. https://example.com').or(z.literal('')),
    firstName: z.string().trim().min(1, 'First name is required').max(100),
    lastName: z.string().trim().min(1, 'Last name is required').max(100),
    email: z.string().trim().email('Enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters').max(200),
    confirmPassword: z.string().min(8, 'Please confirm your password').max(200),
    acceptTerms: z.boolean(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((data) => data.acceptTerms === true, {
    message: 'You must accept the terms to continue',
    path: ['acceptTerms'],
  });

type FormValues = z.infer<typeof formSchema>;

export default function RegisterPage() {
  const router = useRouter();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      organisationName: '',
      displayName: '',
      industry: '',
      country: '',
      state: '',
      city: '',
      phoneNumber: '',
      businessEmail: '',
      website: '',
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      confirmPassword: '',
      acceptTerms: false,
    },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      registerOrganisation({
        ...values,
        displayName: values.displayName || undefined,
        industry: values.industry || undefined,
        state: values.state || undefined,
        city: values.city || undefined,
        phoneNumber: values.phoneNumber || undefined,
        businessEmail: values.businessEmail || undefined,
        website: values.website || undefined,
      }),
    onSuccess: (result) => {
      const params = new URLSearchParams({
        name: result.organisation.name,
        code: result.organisation.organisationCode,
        email: result.owner.email,
      });
      router.push(`/register/success?${params.toString()}`);
    },
  });

  const errors = form.formState.errors;

  return (
    <AuthShell maxWidthClassName="max-w-2xl">
      <div className="mb-10 text-center">
        <h1 className="text-balance text-3xl font-semibold tracking-tight text-brandPurple">
          Create your organisation
        </h1>
        <p className="mt-2 text-muted-foreground">
          Set up your manufacturing operating system in a couple of minutes.
        </p>
      </div>

      <form
        noValidate
        className="space-y-6"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <Card>
          <CardHeader>
            <CardTitle>Organisation Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Organisation Name" required error={errors.organisationName?.message}>
              <Input {...form.register('organisationName')} />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Display Name" error={errors.displayName?.message}>
                <Input {...form.register('displayName')} />
              </Field>
              <Field label="Industry" error={errors.industry?.message}>
                <Input {...form.register('industry')} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Country" required error={errors.country?.message}>
                <Input {...form.register('country')} />
              </Field>
              <Field label="State" error={errors.state?.message}>
                <Input {...form.register('state')} />
              </Field>
              <Field label="City" error={errors.city?.message}>
                <Input {...form.register('city')} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Phone Number" error={errors.phoneNumber?.message}>
                <Input {...form.register('phoneNumber')} />
              </Field>
              <Field label="Business Email" error={errors.businessEmail?.message}>
                <Input type="email" {...form.register('businessEmail')} />
              </Field>
            </div>
            <Field label="Website" error={errors.website?.message}>
              <Input placeholder="https://example.com" {...form.register('website')} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Owner Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="First Name" required error={errors.firstName?.message}>
                <Input {...form.register('firstName')} />
              </Field>
              <Field label="Last Name" required error={errors.lastName?.message}>
                <Input {...form.register('lastName')} />
              </Field>
            </div>
            <Field label="Email" required error={errors.email?.message}>
              <Input type="email" {...form.register('email')} />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Password" required error={errors.password?.message}>
                <Input type="password" {...form.register('password')} />
              </Field>
              <Field label="Confirm Password" required error={errors.confirmPassword?.message}>
                <Input type="password" {...form.register('confirmPassword')} />
              </Field>
            </div>

            <div className="flex items-start gap-2.5 pt-1">
              <Checkbox id="acceptTerms" className="mt-0.5" {...form.register('acceptTerms')} />
              <div>
                <Label htmlFor="acceptTerms" className="font-normal">
                  I agree to the Terms of Service and Privacy Policy
                </Label>
                {errors.acceptTerms && (
                  <p className="mt-1 text-xs text-destructive">{errors.acceptTerms.message}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {mutation.isError && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Something went wrong creating your organisation. Please try again.'}
          </p>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
        >
          {mutation.isPending ? 'Creating your organisation…' : 'Create Organisation'}
        </button>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <a href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </a>
        </p>
      </form>
    </AuthShell>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="text-primary"> *</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
