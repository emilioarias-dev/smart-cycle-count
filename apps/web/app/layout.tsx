import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { THEME_SCRIPT, ThemeToggle } from '../components/ThemeToggle';
import './globals.css';

export const metadata: Metadata = {
  title: 'Smart Cycle Count',
  description: 'Risk-based cycle count planning for warehouse bins',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The inline script sets data-theme before the first paint, so the page
    // never flashes the other theme; React is told the attribute may differ.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <nav className="site-nav" aria-label="Main">
          <Link href="/">Warehouse</Link>
          <Link href="/tasks">Tasks</Link>
          <Link href="/count">Count</Link>
          <ThemeToggle />
        </nav>
        {children}
      </body>
    </html>
  );
}
