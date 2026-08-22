'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@zentuva/ui';

const NAV_ITEMS = [
  { href: '/field', label: 'Home', icon: HomeIcon },
  { href: '/field/customers', label: 'Customers', icon: UsersIcon },
  { href: '/field/outlets', label: 'Outlets', icon: StoreIcon },
  { href: '/field/orders', label: 'Orders', icon: ReceiptIcon },
] as const;

/**
 * Fixed bottom tab bar (Sprint 4.8 brief §20 "Sales Agent Mobile Home") — the primary
 * navigation surface for the Field Sales shell, reachable one-handed from anywhere.
 * `env(safe-area-inset-bottom)` padding keeps it clear of the home indicator on modern
 * phones; `FieldShell`'s `pb-24` on the content area keeps content from being hidden
 * underneath this fixed bar.
 */
export function FieldBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 mx-auto flex w-full max-w-md items-stretch border-t border-border bg-background/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {NAV_ITEMS.map((item) => {
        const active =
          item.href === '/field' ? pathname === '/field' : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 py-2 text-xs',
              active ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <Icon className="h-6 w-6" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function HomeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...props}>
      <path d="M3 11.5 12 4l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UsersIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5" strokeLinecap="round" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15.5 12c2.5.3 4.5 1.7 4.5 4" strokeLinecap="round" />
    </svg>
  );
}

function StoreIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...props}>
      <path
        d="M4 10v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M3 6l1.5-3h15L21 6" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M3 6a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ReceiptIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...props}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 8h6M9 12h6" strokeLinecap="round" />
    </svg>
  );
}
