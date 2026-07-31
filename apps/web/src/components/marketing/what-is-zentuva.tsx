import { Container, SectionHeading } from './container';
import { ZentuvaMark } from './logo';

const PILLARS = [
  'Production',
  'Inventory',
  'Distribution',
  'Sales',
  'Finance',
  'People',
  'Analytics',
  'AI',
  'Retail Intelligence',
];

export function WhatIsZentuva() {
  return (
    <section id="what-is-zentuva" className="py-24">
      <Container>
        <SectionHeading
          eyebrow="What is Zentuva?"
          title="More than software. An operating system."
          description="A single connected foundation that every part of a manufacturing business runs on — instead of a patchwork of tools that don't talk to each other."
        />

        <div className="relative mx-auto mt-16 max-w-3xl rounded-3xl border border-dashed border-border bg-lavender/40 p-8 sm:p-12">
          <div className="flex justify-center">
            <div className="flex items-center gap-3 rounded-2xl bg-primary px-6 py-4 text-primary-foreground shadow-lg">
              <ZentuvaMark className="h-6 w-6" />
              <span className="text-base font-semibold">Zentuva Core</span>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {PILLARS.map((pillar) => (
              <span
                key={pillar}
                className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-sm"
              >
                {pillar}
              </span>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
