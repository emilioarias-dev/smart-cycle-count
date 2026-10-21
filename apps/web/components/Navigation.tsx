'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { Icon, type IconName } from './Icon';
import { useRivy } from './RivyProvider';

// The same three destinations in the top bar (wide screens) and in the tab
// bar (phones). Bin pages belong to the warehouse.
const LINKS: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Warehouse', icon: 'grid' },
  { href: '/tasks', label: 'Tasks', icon: 'list' },
  { href: '/rivy', label: 'Rivy', icon: 'chat' },
  { href: '/count', label: 'Count', icon: 'scan' },
];

// While the next page loads, a thin bar under the link that was followed.
// Always rendered (no layout shift); only its opacity changes.
function Pending() {
  const { pending } = useLinkStatus();
  return <span className={`link-pending${pending ? ' on' : ''}`} aria-hidden="true" />;
}

function useActive(): (href: string) => boolean {
  const pathname = usePathname();
  return (href) => (href === '/' ? pathname === '/' || pathname.startsWith('/bins/') : pathname.startsWith(href));
}

export function TopNav() {
  const isActive = useActive();
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={link.href === '/count' ? 'btn btn-primary' : undefined}
          aria-current={isActive(link.href) ? 'page' : undefined}
        >
          {link.label}
          {link.href === '/count' && <Icon name="arrow" className="arrow" />}
          <Pending />
        </Link>
      ))}
    </nav>
  );
}

// On phones the tab bar is Rivy's way in (the floating button would cover
// the page there): its tab shows that Rivy is answering or has a new answer.
export function TabBar() {
  const isActive = useActive();
  const { pending, unread, markRead } = useRivy();
  const onRivy = isActive('/rivy');
  useEffect(() => {
    if (onRivy && unread) {
      markRead();
    }
  }, [onRivy, unread, markRead]);
  const rivyState = pending ? 'answering' : unread ? 'new answer' : null;
  return (
    <nav className="tabbar" aria-label="Main (phone)">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={isActive(link.href) ? 'page' : undefined}
          aria-label={link.href === '/rivy' && rivyState ? `${link.label}, ${rivyState}` : undefined}
        >
          <span className="tab-icon">
            <Icon name={link.icon} />
            {link.href === '/rivy' && rivyState && <span className={`tab-dot${pending ? ' busy' : ''}`} aria-hidden="true" />}
          </span>
          {link.label}
          <Pending />
        </Link>
      ))}
    </nav>
  );
}
