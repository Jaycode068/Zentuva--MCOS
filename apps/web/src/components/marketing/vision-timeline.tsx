import { Container, SectionHeading } from './container';

const STEPS = [
  { label: 'Today', title: 'Core Manufacturing OS', current: true },
  { label: 'Next', title: 'Retail Intelligence' },
  { label: 'Then', title: 'AI Copilot' },
  { label: 'Vision', title: 'Connected African Supply Chains' },
];

export function VisionTimeline() {
  return (
    <section className="py-24">
      <Container>
        <SectionHeading eyebrow="Platform Vision" title="Where Zentuva is headed." />

        <div className="mx-auto mt-16 max-w-4xl">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-4">
            {STEPS.map((step, index) => (
              <div key={step.title} className="relative flex flex-col items-center text-center">
                <div className="flex w-full items-center">
                  <span className={`h-px flex-1 ${index === 0 ? 'bg-transparent' : 'bg-border'}`} />
                  <span
                    className={`h-3 w-3 shrink-0 rounded-full ${
                      step.current ? 'bg-primary' : 'border-2 border-border bg-background'
                    }`}
                  />
                  <span
                    className={`h-px flex-1 ${index === STEPS.length - 1 ? 'bg-transparent' : 'bg-border'}`}
                  />
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-primary">
                  {step.label}
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">{step.title}</p>
              </div>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
