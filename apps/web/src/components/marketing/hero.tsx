import { buttonVariants, cn } from '@zentuva/ui';

import { Container } from './container';

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-40 -z-10 flex justify-center blur-3xl"
      >
        <div className="h-[36rem] w-[64rem] rounded-full bg-gradient-to-tr from-lavender via-brandPurple/10 to-accentPink/20" />
      </div>

      <Container className="grid items-center gap-16 py-20 lg:grid-cols-2 lg:py-28">
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-lavender px-3 py-1 text-xs font-medium text-lavender-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-accentPink" />
            Now building the future of African manufacturing
          </div>

          <h1 className="text-balance text-4xl font-semibold tracking-tight text-brandPurple sm:text-5xl lg:text-6xl">
            The Operating System for African Manufacturing.
          </h1>

          <p className="mt-6 max-w-xl text-balance text-lg leading-relaxed text-muted-foreground">
            Zentuva connects production, inventory, procurement, distribution, sales, people and
            intelligence into one unified operating system—helping manufacturers scale with
            confidence.
          </p>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <a href="/register" className={cn(buttonVariants({ size: 'lg' }), 'px-8')}>
              Get Started
            </a>
            <a
              href="#cta"
              className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'px-8')}
            >
              Book a Demo
            </a>
          </div>
        </div>

        <div className="relative mx-auto h-[26rem] w-full max-w-md lg:mx-0">
          <DashboardIllustration />
        </div>
      </Container>
    </section>
  );
}

/** Abstract composition of dashboard-style cards — decorative only, not real product data. */
function DashboardIllustration() {
  return (
    <div className="relative h-full w-full" aria-hidden="true">
      <div className="absolute left-0 top-6 w-64 rounded-2xl border border-border bg-card p-5 shadow-xl">
        <p className="text-xs font-medium text-muted-foreground">Production Output</p>
        <p className="mt-2 text-2xl font-semibold text-foreground">12,480 units</p>
        <div className="mt-4 flex h-16 items-end gap-1.5">
          {[40, 65, 50, 80, 60, 95, 70].map((height, index) => (
            <span
              key={index}
              className="flex-1 rounded-t-sm bg-brandPurple/80"
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
      </div>

      <div className="absolute right-0 top-32 w-56 rounded-2xl border border-border bg-card p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">Inventory Health</p>
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </div>
        <p className="mt-2 text-2xl font-semibold text-foreground">98.2%</p>
        <p className="mt-1 text-xs text-muted-foreground">Across 6 warehouses</p>
      </div>

      <div className="absolute bottom-4 left-6 w-60 rounded-2xl border border-border bg-lavender p-5 shadow-xl">
        <p className="text-xs font-medium text-lavender-foreground">Distributor Network</p>
        <div className="mt-3 flex items-center gap-2">
          <span className="h-8 w-8 rounded-full bg-accentPink" />
          <div className="h-1.5 flex-1 rounded-full bg-white/60">
            <div className="h-1.5 w-3/4 rounded-full bg-primary" />
          </div>
        </div>
        <p className="mt-3 text-xs text-lavender-foreground/80">142 active partners</p>
      </div>

      <div className="absolute right-4 bottom-24 w-40 rounded-2xl border border-border bg-brandPurple p-4 text-brandPurple-foreground shadow-xl">
        <p className="text-xs font-medium opacity-80">Sales Today</p>
        <p className="mt-1 text-lg font-semibold text-accentPink">+18.4%</p>
      </div>
    </div>
  );
}
