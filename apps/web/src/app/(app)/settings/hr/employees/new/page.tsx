'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Input, Label, Select, Textarea } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import {
  CreateEmployeePayload,
  EmploymentType,
  Gender,
  createEmployee,
  listDepartments,
  listEmployees,
  listPositions,
} from '../../api';
import { EMPLOYMENT_TYPE_LABELS, GENDER_LABELS } from '../../labels';

export default function NewEmployeePage() {
  const { data: departmentsData } = useQuery({
    queryKey: ['hr-departments'],
    queryFn: () => listDepartments({ status: 'ACTIVE' }),
  });
  const { data: positionsData } = useQuery({
    queryKey: ['hr-positions'],
    queryFn: () => listPositions({ status: 'ACTIVE' }),
  });
  const { data: employeesData } = useQuery({
    queryKey: ['hr-employees', 'for-manager-picker'],
    queryFn: () => listEmployees({ pageSize: 100 }),
  });
  const managerCandidates = (employeesData?.items ?? []).filter(
    (employee) => employee.employmentStatus !== 'SEPARATED',
  );

  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [personalEmail, setPersonalEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [alternatePhoneNumber, setAlternatePhoneNumber] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [nationality, setNationality] = useState('');
  const [address, setAddress] = useState('');
  const [emergencyContactName, setEmergencyContactName] = useState('');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('');
  const [emergencyContactRelationship, setEmergencyContactRelationship] = useState('');

  const [employmentType, setEmploymentType] = useState<EmploymentType>('FULL_TIME');
  const [hireDate, setHireDate] = useState('');
  const [probationEndDate, setProbationEndDate] = useState('');
  const [notes, setNotes] = useState('');

  const [departmentId, setDepartmentId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [managerEmployeeId, setManagerEmployeeId] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      const payload: CreateEmployeePayload = {
        firstName: firstName.trim(),
        middleName: middleName.trim() || undefined,
        lastName: lastName.trim(),
        preferredName: preferredName.trim() || undefined,
        workEmail: workEmail.trim() || undefined,
        personalEmail: personalEmail.trim() || undefined,
        phoneNumber: phoneNumber.trim() || undefined,
        alternatePhoneNumber: alternatePhoneNumber.trim() || undefined,
        dateOfBirth: dateOfBirth || undefined,
        gender: gender || undefined,
        nationality: nationality.trim() || undefined,
        address: address.trim() || undefined,
        emergencyContactName: emergencyContactName.trim() || undefined,
        emergencyContactPhone: emergencyContactPhone.trim() || undefined,
        emergencyContactRelationship: emergencyContactRelationship.trim() || undefined,
        departmentId: departmentId || undefined,
        positionId: positionId || undefined,
        managerEmployeeId: managerEmployeeId || undefined,
        employmentType,
        hireDate,
        probationEndDate: probationEndDate || undefined,
        notes: notes.trim() || undefined,
      };
      return createEmployee(payload);
    },
    onSuccess: (employee) => {
      window.location.assign(`/settings/hr/employees/${employee.id}`);
    },
  });

  const canSubmit = firstName.trim().length > 0 && lastName.trim().length > 0 && !!hireDate;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <div>
        <a href="/settings/hr/employees" className="text-sm text-muted-foreground">
          ← All Employees
        </a>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">New Employee</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          User account linking, onboarding, and documents are managed after the record is created.
        </p>
      </div>

      <form
        className="space-y-8"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) mutation.mutate();
        }}
      >
        <Section title="Personal & Contact Information">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="First Name *">
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </Field>
            <Field label="Middle Name">
              <Input value={middleName} onChange={(e) => setMiddleName(e.target.value)} />
            </Field>
            <Field label="Last Name *">
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </Field>
            <Field label="Preferred Name">
              <Input value={preferredName} onChange={(e) => setPreferredName(e.target.value)} />
            </Field>
            <Field label="Work Email">
              <Input
                type="email"
                value={workEmail}
                onChange={(e) => setWorkEmail(e.target.value)}
              />
            </Field>
            <Field label="Personal Email">
              <Input
                type="email"
                value={personalEmail}
                onChange={(e) => setPersonalEmail(e.target.value)}
              />
            </Field>
            <Field label="Phone Number">
              <Input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
            </Field>
            <Field label="Alternate Phone Number">
              <Input
                value={alternatePhoneNumber}
                onChange={(e) => setAlternatePhoneNumber(e.target.value)}
              />
            </Field>
            <Field label="Date of Birth">
              <Input
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
              />
            </Field>
            <Field label="Gender">
              <Select value={gender} onChange={(e) => setGender(e.target.value as Gender | '')}>
                <option value="">Not specified</option>
                {Object.entries(GENDER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Nationality">
              <Input value={nationality} onChange={(e) => setNationality(e.target.value)} />
            </Field>
          </div>
          <Field label="Address">
            <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Emergency Contact Name">
              <Input
                value={emergencyContactName}
                onChange={(e) => setEmergencyContactName(e.target.value)}
              />
            </Field>
            <Field label="Emergency Contact Phone">
              <Input
                value={emergencyContactPhone}
                onChange={(e) => setEmergencyContactPhone(e.target.value)}
              />
            </Field>
            <Field label="Relationship">
              <Input
                value={emergencyContactRelationship}
                onChange={(e) => setEmergencyContactRelationship(e.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section title="Employment Details">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Employment Type *">
              <Select
                value={employmentType}
                onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}
              >
                {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Hire Date *">
              <Input
                type="date"
                value={hireDate}
                onChange={(e) => setHireDate(e.target.value)}
                required
              />
            </Field>
            <Field label="Probation End Date">
              <Input
                type="date"
                value={probationEndDate}
                onChange={(e) => setProbationEndDate(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </Section>

        <Section title="Organisation Assignment">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Department">
              <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">None</option>
                {(departmentsData?.items ?? []).map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Position">
              <Select value={positionId} onChange={(e) => setPositionId(e.target.value)}>
                <option value="">None</option>
                {(positionsData?.items ?? []).map((position) => (
                  <option key={position.id} value={position.id}>
                    {position.title}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Section>

        <Section title="Reporting Relationship">
          <Field label="Manager">
            <Select
              value={managerEmployeeId}
              onChange={(e) => setManagerEmployeeId(e.target.value)}
            >
              <option value="">No manager</option>
              {managerCandidates.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.firstName} {employee.lastName} ({employee.employeeCode})
                </option>
              ))}
            </Select>
          </Field>
        </Section>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to create employee.'}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => window.location.assign('/settings/hr/employees')}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create Employee'}
          </Button>
        </div>
      </form>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border p-4 sm:p-6">
      <h2 className="mb-4 text-sm font-semibold">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
