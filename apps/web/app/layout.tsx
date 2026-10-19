import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Smart Cycle Count',
  description: 'Risk-based cycle count planning for warehouse bins',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="site-nav" aria-label="Main">
          <Link href="/">Warehouse</Link>
          <Link href="/tasks">Tasks</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
