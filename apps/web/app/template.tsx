import type { ReactNode } from 'react';

// Each page fades in briefly when it is opened (none with reduced motion,
// see globals.css). The header, Rivy's panel and the tab bar are in the
// layout and do not move.
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
