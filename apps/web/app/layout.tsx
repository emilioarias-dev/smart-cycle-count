import type { Metadata } from 'next';
import localFont from 'next/font/local';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { TabBar, TopNav } from '../components/Navigation';
import { THEME_SCRIPT, ThemeToggle } from '../components/ThemeToggle';
import './globals.css';

// Rivero's typeface (D-013): Onest, latin subset, variable weight 400–700,
// stored in the repository (SIL Open Font License, app/fonts/OFL.txt) so the
// build needs no network and the browser never calls a font service.
const onest = localFont({
  src: './fonts/onest-latin.woff2',
  weight: '400 700',
  style: 'normal',
  variable: '--font-onest',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Smart Cycle Count',
  description: 'Risk-based cycle count planning for warehouse bins',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The inline script sets data-theme before the first paint, so the page
    // never flashes the other theme; React is told the attribute may differ.
    <html lang="en" className={onest.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <header className="topbar">
          <div className="shell">
            <Link className="logo" href="/" aria-label="Smart Cycle Count by Rivero, warehouse">
              {/* eslint-disable-next-line @next/next/no-img-element -- a small fixed logo */}
              <img src="/rivero-logo.png" alt="Rivero" width={1080} height={221} />
              <span className="product">
                Smart
                <br />
                Cycle Count
              </span>
            </Link>
            <TopNav />
            <span className="proto" title="A prototype with synthetic demo data">
              <b>Prototype</b>
              <span>synthetic demo data</span>
            </span>
            <ThemeToggle />
          </div>
        </header>
        {children}
        <TabBar />
      </body>
    </html>
  );
}
