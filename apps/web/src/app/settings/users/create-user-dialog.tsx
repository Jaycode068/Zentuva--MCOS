'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
} from '@zentuva/ui';
import { createUserSchema, type CreateUserInput } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { ApiError } from '@/lib/api-client';

import { createUser } from './api';

export function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const form = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      employeeCode: '',
      role: 'Member',
      temporaryPassword: '',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: CreateUserInput) =>
      createUser({ ...values, employeeCode: values.employeeCode || undefined }),
    onSuccess: () => {
      onCreated();
      form.reset();
      onOpenChange(false);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) form.reset();
        onOpenChange(next);
      }}
    >
      <DialogHeader>
        <DialogTitle>Create User</DialogTitle>
      </DialogHeader>
      <form className="space-y-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>First Name</Label>
            <Input {...form.register('firstName')} />
            {form.formState.errors.firstName && (
              <p className="text-xs text-destructive">{form.formState.errors.firstName.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Last Name</Label>
            <Input {...form.register('lastName')} />
            {form.formState.errors.lastName && (
              <p className="text-xs text-destructive">{form.formState.errors.lastName.message}</p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input type="email" {...form.register('email')} />
          {form.formState.errors.email && (
            <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Employee Code (optional)</Label>
          <Input {...form.register('employeeCode')} />
        </div>

        <div className="space-y-1.5">
          <Label>Role</Label>
          <Select {...form.register('role')}>
            <option value="Owner">Owner</option>
            <option value="Administrator">Administrator</option>
            <option value="Member">Member</option>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Temporary Password</Label>
          <Input {...form.register('temporaryPassword')} />
          {form.formState.errors.temporaryPassword && (
            <p className="text-xs text-destructive">
              {form.formState.errors.temporaryPassword.message}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Share this with the user directly — there is no invitation email yet.
          </p>
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : 'Failed to create user.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create User'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
