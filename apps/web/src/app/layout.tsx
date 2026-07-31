import type { Metadata } from 'next';

import { QueryProvider } from '@/providers/query-provider';

import './globals.css';

export const metadata: Metadata = {
  title: 'Zentuva — The Operating System for African Manufacturing',
  description:
    'Zentuva connects production, inventory, procurement, distribution, sales, people and intelligence into one unified operating system — helping manufacturers scale with confidence.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
