'use client';

import * as React from 'react';
import { cn, Input, type InputProps } from '@zentuva/ui';

/** A password `<Input>` with a show/hide toggle (Sprint 3.3 §6 "Show/Hide password") —
 *  shared by /login, /reset-password/[token], and /change-password rather than each page
 *  re-implementing the toggle. */
export const PasswordInput = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);

    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn('pr-10', className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((prev) => !prev)}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
          aria-label={visible ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
      <path
        d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
      <path
        d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 10.5 8 10.5 8a15.3 15.3 0 0 1-4.24 5.06M6.6 6.6C3.9 8.3 1.5 12 1.5 12s3.5 8 10.5 8a10.4 10.4 0 0 0 4.6-1.02"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
