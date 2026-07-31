import { cn } from '@zentuva/ui';

/**
 * A simplified reconstruction of the Zentuva mark (bold, angular "Z" — top bar, diagonal,
 * bottom bar) in the brand's deep purple. The real logo (shared in chat as an image, not a
 * file) is a circular seal: this angular "Z" plus a lavender arc, two pink diamond accents,
 * and a curved "ZENTUVA" wordmark. No file asset was ever placed in the repo, so this is a
 * best-effort recreation rather than the literal source file — see
 * docs/sprint-3.1-completion-report.md "Known limitations." Drop the real SVG/PNG into
 * `apps/web/public/` to replace this once available.
 */
export function ZentuvaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" fill="none" className={className} aria-hidden="true">
      <rect x="14" y="14" width="72" height="22" rx="2" fill="currentColor" />
      <polygon points="72,36 86,36 28,64 14,64" fill="currentColor" />
      <rect x="14" y="64" width="72" height="22" rx="2" fill="currentColor" />
    </svg>
  );
}

export function Logo({ className, iconClassName }: { className?: string; iconClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <span
        className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground',
          iconClassName,
        )}
      >
        <ZentuvaMark className="h-4 w-4" />
      </span>
      <span className="text-lg text-foreground">Zentuva</span>
    </span>
  );
}
