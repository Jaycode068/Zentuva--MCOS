import { Container, SectionHeading } from './container';
import { AiIcon } from './icons';

const CAPABILITIES = [
  'Production optimization',
  'Inventory forecasting',
  'Sales prediction',
  'Demand forecasting',
  'Quality monitoring',
  'Decision support',
];

export function AiSection() {
  return (
    <section className="py-24">
      <Container>
        <div className="mx-auto max-w-3xl rounded-3xl border border-border bg-gradient-to-br from-lavender via-card to-card p-8 sm:p-12">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brandPurple text-brandPurple-foreground">
            <AiIcon className="h-6 w-6" />
          </div>

          <SectionHeading
            className="mt-6"
            title="Built for the AI era."
            description="Every manufacturing process will eventually become AI-assisted. Zentuva is architected for that future from day one — a connected data foundation is what makes it possible."
          />

          <p className="mx-auto mt-8 max-w-lg text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Part of the platform vision — not yet available
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2.5">
            {CAPABILITIES.map((capability) => (
              <span
                key={capability}
                className="rounded-full border border-dashed border-primary/30 bg-background px-4 py-2 text-sm font-medium text-foreground"
              >
                {capability}
              </span>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
