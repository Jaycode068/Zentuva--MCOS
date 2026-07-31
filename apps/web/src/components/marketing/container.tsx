import { cn } from '@zentuva/ui';

export function Container({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn('mx-auto w-full max-w-6xl px-6 lg:px-8', className)}>{children}</div>;
}

export function SectionHeading({
  eyebrow,
  eyebrowClassName,
  title,
  description,
  align = 'center',
  className,
}: {
  eyebrow?: string;
  /** Override for sections on a dark background — deep purple reads poorly there. */
  eyebrowClassName?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: 'center' | 'left';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mx-auto max-w-2xl',
        align === 'center' ? 'text-center' : 'text-left ml-0',
        className,
      )}
    >
      {eyebrow && (
        <p
          className={cn(
            'mb-3 text-sm font-semibold uppercase tracking-wider text-brandPurple',
            eyebrowClassName,
          )}
        >
          {eyebrow}
        </p>
      )}
      <h2 className="text-balance text-3xl font-semibold tracking-tight text-brandPurple sm:text-4xl">
        {title}
      </h2>
      {description && (
        <p className="mt-4 text-balance text-lg leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
