import { Container } from './container';

const PLACEHOLDERS = [
  'Pilot Manufacturers',
  'Growing Businesses',
  'Future Partners',
  'Coming Soon',
];

export function TrustedBy() {
  return (
    <section className="border-y border-border/60 bg-muted/40 py-10">
      <Container>
        <p className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Built for the manufacturers shaping what&apos;s next
        </p>
        <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
          {PLACEHOLDERS.map((label) => (
            <div
              key={label}
              className="flex h-16 items-center justify-center rounded-lg border border-dashed border-border text-sm font-medium text-muted-foreground"
            >
              {label}
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
