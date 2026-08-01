'use client';

import { cn } from '@zentuva/ui';

/** Sprint 3.3 §2 "Show strength indicator" — mirrors `strongPasswordSchema` in
 *  `@zentuva/validation` exactly (min length, uppercase, lowercase, number, special
 *  character) so what the meter shows always matches what the API will actually accept. */
const REQUIREMENTS: { label: string; test: (password: string) => boolean }[] = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'One number', test: (p) => /[0-9]/.test(p) },
  { label: 'One special character', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export function PasswordStrength({ password }: { password: string }) {
  const passed = REQUIREMENTS.filter((r) => r.test(password)).length;
  const percent = (passed / REQUIREMENTS.length) * 100;
  const strengthLabel = passed <= 2 ? 'Weak' : passed <= 4 ? 'Fair' : 'Strong';
  const barColor = passed <= 2 ? 'bg-destructive' : passed <= 4 ? 'bg-yellow-500' : 'bg-primary';

  return (
    <div className="space-y-2">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className={cn('h-full rounded-full transition-all', barColor)}
          style={{ width: `${percent}%` }}
        />
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {REQUIREMENTS.map((requirement) => {
          const met = requirement.test(password);
          return (
            <li
              key={requirement.label}
              className={cn('text-xs', met ? 'text-primary' : 'text-muted-foreground')}
            >
              {met ? '✓' : '○'} {requirement.label}
            </li>
          );
        })}
      </ul>
      {password.length > 0 && (
        <p className="text-xs font-medium text-muted-foreground">
          Strength: <span className="text-foreground">{strengthLabel}</span>
        </p>
      )}
    </div>
  );
}
