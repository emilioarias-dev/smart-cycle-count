import Link from 'next/link';
import type { ReactNode } from 'react';

// Shared not-found and error states.
export function StatusCard(props: {
  kind: 'notice' | 'error';
  title: string;
  children: ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <section className={`card ${props.kind}`} role={props.kind === 'error' ? 'alert' : 'status'}>
      <h2>{props.title}</h2>
      <p>{props.children}</p>
      {props.action && (
        <Link className="action" href={props.action.href}>
          {props.action.label}
        </Link>
      )}
    </section>
  );
}
