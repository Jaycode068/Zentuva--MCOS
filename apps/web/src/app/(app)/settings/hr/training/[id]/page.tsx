'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Dialog,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
} from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import {
  activateTrainingCourse,
  archiveTrainingCourse,
  assignTraining,
  cancelTrainingAssignment,
  completeTrainingAssignment,
  getTrainingCourse,
  listEmployees,
  listTrainingAssignments,
} from '../../api';
import {
  EMPLOYEE_TRAINING_STATUS_LABELS,
  EMPLOYEE_TRAINING_STATUS_VARIANT,
  TRAINING_COURSE_STATUS_LABELS,
  TRAINING_COURSE_STATUS_VARIANT,
  TRAINING_DELIVERY_MODE_LABELS,
} from '../../labels';

export default function TrainingCourseDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);

  const { data: course, isLoading } = useQuery({
    queryKey: ['hr-training-course', id],
    queryFn: () => getTrainingCourse(id),
  });
  const { data: assignmentsData, refetch: refetchAssignments } = useQuery({
    queryKey: ['hr-training-assignments', id],
    queryFn: () => listTrainingAssignments({ trainingCourseId: id, pageSize: 100 }),
  });

  const activateMutation = useMutation({
    mutationFn: () => activateTrainingCourse(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hr-training-course', id] }),
  });
  const archiveMutation = useMutation({
    mutationFn: () => archiveTrainingCourse(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hr-training-course', id] }),
  });
  const completeMutation = useMutation({
    mutationFn: (assignmentId: string) => completeTrainingAssignment(assignmentId),
    onSuccess: () => refetchAssignments(),
  });
  const cancelMutation = useMutation({
    mutationFn: (assignmentId: string) => cancelTrainingAssignment(assignmentId),
    onSuccess: () => refetchAssignments(),
  });

  const assignments = assignmentsData?.items ?? [];

  if (isLoading || !course) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="text-center text-sm text-muted-foreground">Loading course…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <a href="/settings/hr/training" className="text-sm text-muted-foreground hover:underline">
        ← Back to Training
      </a>

      <div className="mt-4 flex items-center justify-between">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{course.code}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{course.title}</h1>
        </div>
        <Badge variant={TRAINING_COURSE_STATUS_VARIANT[course.status]}>
          {TRAINING_COURSE_STATUS_LABELS[course.status]}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {TRAINING_DELIVERY_MODE_LABELS[course.deliveryMode]}
        {course.durationMinutes ? ` · ${course.durationMinutes} min` : ''}
        {course.provider ? ` · ${course.provider}` : ''}
      </p>
      {course.description && <p className="mt-2 text-sm">{course.description}</p>}

      <div className="mt-4 flex gap-2">
        {course.status !== 'ACTIVE' && (
          <Button
            size="sm"
            disabled={activateMutation.isPending}
            onClick={() => activateMutation.mutate()}
          >
            Activate
          </Button>
        )}
        {course.status !== 'ARCHIVED' && (
          <Button
            size="sm"
            variant="outline"
            disabled={archiveMutation.isPending}
            onClick={() => archiveMutation.mutate()}
          >
            Archive
          </Button>
        )}
        {course.status === 'ACTIVE' && (
          <Button size="sm" variant="outline" onClick={() => setAssignOpen(true)}>
            Assign to Employee
          </Button>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold">Assignments</h2>
        {assignments.length === 0 && (
          <p className="text-sm text-muted-foreground">No employees assigned yet.</p>
        )}
        <div className="space-y-2">
          {assignments.map((assignment) => (
            <div
              key={assignment.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
            >
              <div>
                <p className="font-medium">
                  {assignment.employee?.firstName} {assignment.employee?.lastName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {assignment.dueDate
                    ? `Due ${new Date(assignment.dueDate).toLocaleDateString()}`
                    : 'No due date'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={EMPLOYEE_TRAINING_STATUS_VARIANT[assignment.status]}>
                  {EMPLOYEE_TRAINING_STATUS_LABELS[assignment.status]}
                </Badge>
                {['ASSIGNED', 'IN_PROGRESS', 'OVERDUE'].includes(assignment.status) && (
                  <>
                    <Button
                      size="sm"
                      disabled={completeMutation.isPending}
                      onClick={() => completeMutation.mutate(assignment.id)}
                    >
                      Complete
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={cancelMutation.isPending}
                      onClick={() => cancelMutation.mutate(assignment.id)}
                    >
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {assignOpen && (
        <AssignDialog
          courseId={id}
          onClose={() => setAssignOpen(false)}
          onSaved={() => {
            setAssignOpen(false);
            refetchAssignments();
          }}
        />
      )}
    </main>
  );
}

function AssignDialog({
  courseId,
  onClose,
  onSaved,
}: {
  courseId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [dueDate, setDueDate] = useState('');

  const { data: employeesData } = useQuery({
    queryKey: ['hr-employees', 'for-training'],
    queryFn: () => listEmployees({ pageSize: 100, employmentStatus: 'ACTIVE' }),
  });

  const mutation = useMutation({
    mutationFn: () => assignTraining(courseId, { employeeId, dueDate: dueDate || undefined }),
    onSuccess: onSaved,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogHeader>
        <DialogTitle>Assign Training</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (employeeId) mutation.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label>Employee</Label>
          <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Select an employee</option>
            {(employeesData?.items ?? []).map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.employeeCode} — {employee.firstName} {employee.lastName}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Due Date (optional)</Label>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to assign training.'}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!employeeId || mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Assign'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
