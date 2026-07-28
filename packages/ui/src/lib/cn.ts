import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges Tailwind class lists, resolving conflicts (used by every shadcn/ui-style component). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
