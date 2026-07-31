import { Container, SectionHeading } from './container';

const PROBLEMS = [
  'Disconnected inventory across locations',
  'Manual, error-prone production tracking',
  'Procurement delays with no visibility',
  'Poor distributor and reseller visibility',
  'No insight into consumer demand',
  'Scattered spreadsheets holding it together',
  'No real-time reporting to act on',
];

export function ProblemSection() {
  return (
    <section className="py-24">
      <Container>
        <SectionHeading title="Manufacturing shouldn't require ten different systems." />

        <div className="mx-auto mt-14 grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2">
          {PROBLEMS.map((problem) => (
            <div
              key={problem}
              className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </span>
              <p className="text-sm font-medium text-foreground">{problem}</p>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-10 max-w-4xl rounded-2xl bg-brandPurple px-8 py-10 text-center">
          <p className="text-balance text-2xl font-semibold text-brandPurple-foreground">
            Zentuva brings everything together.
          </p>
          <p className="mx-auto mt-3 max-w-xl text-balance text-brandPurple-foreground/80">
            One operating system for every part of the business — instead of ten disconnected tools
            quietly working against each other.
          </p>
        </div>
      </Container>
    </section>
  );
}
