import { Container, SectionHeading } from './container';

const PRINCIPLES = [
  {
    title: 'Built for African manufacturers',
    description:
      'Designed around how businesses actually operate here — not adapted from somewhere else.',
  },
  {
    title: 'Cloud-native',
    description: 'No servers to manage, no installations — access it from anywhere, on any device.',
  },
  {
    title: 'Multi-tenant',
    description: 'Every organisation runs on isolated, secure infrastructure from day one.',
  },
  {
    title: 'Fast',
    description:
      'Built for speed at every layer, from the interface to the underlying architecture.',
  },
  {
    title: 'Secure',
    description: 'Tenant isolation, audit logging, and role-based access built in, not bolted on.',
  },
  {
    title: 'Modern',
    description:
      'A clean, considered interface — the kind of software people actually enjoy using.',
  },
  {
    title: 'Extensible',
    description: 'A modular platform that grows with the business, one capability at a time.',
  },
  {
    title: 'API-first',
    description: 'Every capability is built on an API — ready to connect to what you already use.',
  },
  {
    title: 'AI-ready',
    description: 'A foundation designed from the start for intelligent, AI-assisted operations.',
  },
];

export function WhyZentuva() {
  return (
    <section id="why-zentuva" className="bg-muted/40 py-24">
      <Container>
        <SectionHeading eyebrow="Why Zentuva" title="Principles the platform is built on." />

        <div className="mt-16 grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {PRINCIPLES.map(({ title, description }) => (
            <div key={title}>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brandPurple/10 text-brandPurple">
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3 className="mt-3 text-base font-semibold text-foreground">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
