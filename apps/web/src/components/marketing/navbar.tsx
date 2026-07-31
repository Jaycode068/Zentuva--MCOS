'use client';

import { useState } from 'react';
import { buttonVariants } from '@zentuva/ui';

import { Container } from './container';
import { Logo } from './logo';

const NAV_LINKS = [
  { label: 'Products', href: '#platform-modules' },
  { label: 'Solutions', href: '#retail-intelligence' },
  { label: 'Why Zentuva', href: '#why-zentuva' },
  { label: 'About', href: '#what-is-zentuva' },
  { label: 'Contact', href: '#cta' },
];

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between">
        <a href="/" className="shrink-0" aria-label="Zentuva home">
          <Logo />
        </a>

        <nav className="hidden items-center gap-8 lg:flex" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <a href="/login" className={buttonVariants({ variant: 'ghost' })}>
            Sign In
          </a>
          <a href="/register" className={buttonVariants({ variant: 'default' })}>
            Get Started
          </a>
        </div>

        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground lg:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? (
            <svg
              viewBox="0 0 24 24"
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </Container>

      {open && (
        <div className="border-t border-border/60 bg-background lg:hidden">
          <Container className="flex flex-col gap-1 py-4">
            {NAV_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-border/60 pt-4">
              <a href="/login" className={buttonVariants({ variant: 'outline' })}>
                Sign In
              </a>
              <a
                href="/register"
                className={buttonVariants({ variant: 'default' })}
                onClick={() => setOpen(false)}
              >
                Get Started
              </a>
            </div>
          </Container>
        </div>
      )}
    </header>
  );
}
