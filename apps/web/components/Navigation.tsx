'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { Icon, type IconName } from './Icon';
import { RivyAvatar } from './RivyAvatar';
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

// On phones the tab bar is Rivy's way in, where no floating button covers
// the page: Rivy's tab shows the smiling avatar and opens the same panel
// (and conversation) as the floating button, without leaving the page. It
// carries the button's states: a ring while answering, a dot for a new
// answer. On /rivy itself it is the current page.
export function TabBar() {
  const isActive = useActive();
  const { pending, unread, markRead, open, setOpen } = useRivy();
  const onRivy = isActive('/rivy');
  useEffect(() => {
    if (onRivy && unread) {
      markRead();
    }
  }, [onRivy, unread, markRead]);
  const rivyState = pending ? ', answering' : unread ? ', new answer' : '';
  const avatar = (
    <span className={`tab-avatar${pending ? ' busy' : ''}`}>
      <RivyAvatar size={22} />
      {unread && <span className="tab-dot" aria-hidden="true" />}
    </span>
  );
  return (
    <nav className="tabbar" aria-label="Main (phone)">
      {LINKS.map((link) =>
        link.href !== '/rivy' ? (
          <Link key={link.href} href={link.href} aria-current={isActive(link.href) ? 'page' : undefined}>
            <Icon name={link.icon} />
            {link.label}
            <Pending />
          </Link>
        ) : onRivy ? (
          <Link key={link.href} href={link.href} aria-current="page">
            {avatar}
            {link.label}
          </Link>
        ) : (
          <button
            key={link.href}
            type="button"
            className="tab-rivy"
            data-rivy-launcher=""
            aria-label={`Open Rivy assistant${rivyState}`}
            aria-expanded={open}
            aria-controls="rivy-panel"
            onClick={() => setOpen(true)}
          >
            {avatar}
            {link.label}
          </button>
        ),
      )}
    </nav>
  );
}
