import Link from 'next/link';
import { cn } from '@zentuva/ui';

/**
 * A full-width, tappable card row — the mobile-first replacement for a desktop table
 * row (Sprint 4.8 brief §3 "cards rather than dense tables"). Renders as a `Link` when
 * `href` is given, a `button` otherwise.
 */
export function FieldCard({
  href,
  onClick,
  className,
  children,
}: {
  href?: string;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const classes = cn(
    'block w-full rounded-xl border border-border bg-card p-4 text-left shadow-sm active:bg-muted/50',
    className,
  );
  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={classes}>
      {children}
    </button>
  );
}
