import { cn } from '@zentuva/ui';

import { Container } from '../marketing/container';
import { Logo } from '../marketing/logo';

/** Shared page chrome for the unauthenticated auth flow (/register, /login) — a soft
 *  lavender backdrop with the same top bar treatment as the marketing site, so the
 *  onboarding flow reads as the same product rather than a bolted-on admin form. */
export function AuthShell({
  children,
  maxWidthClassName = 'max-w-xl',
}: {
  children: React.ReactNode;
  maxWidthClassName?: string;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-lavender/60 to-background">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur-md">
        <Container className="flex h-16 items-center justify-between">
          <a href="/" aria-label="Zentuva home">
            <Logo />
          </a>
          <a
            href="/"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Back to Website
          </a>
        </Container>
      </header>

      <main className={cn('mx-auto px-6 py-12 sm:py-16', maxWidthClassName)}>{children}</main>
    </div>
  );
}
