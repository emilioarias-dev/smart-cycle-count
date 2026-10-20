import Link from 'next/link';
import type { ReactNode } from 'react';

// Shared not-found, empty and error states.
export function StatusCard(props: {
  kind: 'notice' | 'error';
  title: string;
  children: ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <section className={`callout ${props.kind === 'error' ? 'error' : 'info'}`} role={props.kind === 'error' ? 'alert' : 'status'}>
      <h2>{props.title}</h2>
      <p>{props.children}</p>
      {props.action && (
        <Link className="btn btn-outline btn-sm" href={props.action.href}>
          {props.action.label}
        </Link>
      )}
    </section>
  );
}
