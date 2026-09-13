'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Dialog,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  Textarea,
} from '@zentuva/ui';

import { HrTabs } from '@/components/app/hr-tabs';
import { ApiError } from '@/lib/api-client';

import { createTrainingCourse, listTrainingCourses } from '../api';
import {
  TRAINING_COURSE_STATUS_LABELS,
  TRAINING_COURSE_STATUS_VARIANT,
  TRAINING_DELIVERY_MODE_LABELS,
} from '../labels';

export default function TrainingCoursesPage() {
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['hr-training-courses'],
    queryFn: () => listTrainingCourses(),
  });

  const courses = data?.items ?? [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Human Resources</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Training catalogue and employee assignments.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New Course</Button>
      </div>

      <HrTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading courses…</p>
      )}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load training courses.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && courses.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">No training courses yet.</p>
      )}

      {!isLoading && !isError && courses.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {courses.map((course) => (
            <a
              key={course.id}
              href={`/settings/hr/training/${course.id}`}
              className="rounded-lg border border-border p-4 hover:border-primary"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-muted-foreground">{course.code}</span>
                <Badge variant={TRAINING_COURSE_STATUS_VARIANT[course.status]}>
                  {TRAINING_COURSE_STATUS_LABELS[course.status]}
                </Badge>
              </div>
              <h3 className="mt-1 font-medium">{course.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {TRAINING_DELIVERY_MODE_LABELS[course.deliveryMode]}
                {course.durationMinutes ? ` · ${course.durationMinutes} min` : ''}
              </p>
            </a>
          ))}
        </div>
      )}

      {createOpen && (
        <CourseDialog
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            refetch();
          }}
        />
      )}
    </main>
  );
}

function CourseDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState('');
  const [deliveryMode, setDeliveryMode] = useState<
    'IN_PERSON' | 'ONLINE' | 'BLENDED' | 'SELF_STUDY'
  >('IN_PERSON');
  const [durationMinutes, setDurationMinutes] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      createTrainingCourse({
        code: code.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        provider: provider.trim() || undefined,
        deliveryMode,
        durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
      }),
    onSuccess: onSaved,
  });

  const canSubmit = code.trim().length > 0 && title.trim().length > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogHeader>
        <DialogTitle>New Training Course</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) mutation.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Description</Label>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Input value={provider} onChange={(e) => setProvider(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Duration (minutes)</Label>
            <Input
              type="number"
              min={1}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Delivery Mode</Label>
          <Select value={deliveryMode} onChange={(e) => setDeliveryMode(e.target.value as never)}>
            <option value="IN_PERSON">In Person</option>
            <option value="ONLINE">Online</option>
            <option value="BLENDED">Blended</option>
            <option value="SELF_STUDY">Self Study</option>
          </Select>
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : 'Failed to save course.'}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
