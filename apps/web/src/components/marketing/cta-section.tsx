import { buttonVariants, cn } from '@zentuva/ui';

import { Container } from './container';

export function CtaSection() {
  return (
    <section id="cta" className="py-24">
      <Container>
        <div className="relative overflow-hidden rounded-3xl bg-primary px-8 py-16 text-center sm:px-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-accentPink/30 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-16 -left-16 h-64 w-64 rounded-full bg-lavender/30 blur-3xl"
          />

          <h2 className="relative text-balance text-3xl font-semibold tracking-tight text-primary-foreground sm:text-4xl">
            Ready to run your manufacturing business on a true operating system?
          </h2>
          <p className="relative mx-auto mt-4 max-w-xl text-balance text-primary-foreground/80">
            Join the manufacturers building the future of African production with Zentuva.
          </p>

          <div className="relative mt-10 flex flex-col justify-center gap-3 sm:flex-row">
            <a
              href="#"
              className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }), 'px-8')}
            >
              Request Demo
            </a>
            <a
              href="#"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'border-primary-foreground/30 bg-transparent px-8 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground',
              )}
            >
              Join Early Access
            </a>
          </div>
        </div>
      </Container>
    </section>
  );
}
