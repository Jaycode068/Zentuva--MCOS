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
import { updateUserSchema, type UpdateUserInput } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { ApiError } from '@/lib/api-client';

import { OrgUser, updateUser } from './api';

export function EditUserDialog({
  user,
  onOpenChange,
  onUpdated,
}: {
  user: OrgUser;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}) {
  const form = useForm<UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      firstName: user.firstName,
      lastName: user.lastName,
      employeeCode: user.employeeCode ?? '',
      role: (user.role as UpdateUserInput['role']) ?? undefined,
      status: user.status,
    },
  });

  const mutation = useMutation({
    mutationFn: (values: UpdateUserInput) =>
      updateUser(user.id, { ...values, employeeCode: values.employeeCode || undefined }),
    onSuccess: () => {
      onUpdated();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Edit User</DialogTitle>
      </DialogHeader>
      <form className="space-y-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input value={user.email} disabled />
        </div>

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
          <Label>Employee Code</Label>
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
          <Label>Status</Label>
          <Select {...form.register('status')}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="LOCKED">Locked</option>
          </Select>
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : 'Failed to update user.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
