import { Container, SectionHeading } from './container';

const CHAIN = ['Factory', 'Distributor', 'Wholesaler', 'Retail Shop', 'Consumer'];

const INSIGHTS = [
  'Market demand, region by region',
  'Consumer behavior and buying patterns',
  'Stock movement across the whole chain',
  'Sales trends as they happen',
  'Regional performance, at a glance',
];

export function RetailIntelligence() {
  return (
    <section id="retail-intelligence" className="bg-foreground py-24 text-background">
      <Container>
        <SectionHeading
          eyebrow="The Zentuva Difference"
          title={
            <span className="text-background">
              Beyond ERP. Know what happens after the product leaves your factory.
            </span>
          }
          description={
            <span className="text-background/70">
              Zentuva connects every link in the chain — so manufacturers finally see what happens
              to their product in the real world, not just in the warehouse.
            </span>
          }
        />

        <div className="mx-auto mt-16 flex max-w-4xl flex-wrap items-center justify-center gap-3">
          {CHAIN.map((step, index) => (
            <div key={step} className="flex items-center gap-3">
              <div className="rounded-full border border-background/20 bg-background/5 px-5 py-2.5 text-sm font-medium">
                {step}
              </div>
              {index < CHAIN.length - 1 && (
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 text-background/40"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          ))}
        </div>

        <div className="mx-auto mt-16 grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {INSIGHTS.map((insight) => (
            <div
              key={insight}
              className="rounded-xl border border-background/10 bg-background/5 p-4 text-center text-sm font-medium"
            >
              {insight}
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
