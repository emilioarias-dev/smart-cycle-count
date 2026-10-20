import type { Metadata } from 'next';
import { RivyChat } from '../../components/RivyChat';
import { Icon } from '../../components/Icon';

export const metadata: Metadata = { title: 'Rivy · Smart Cycle Count' };

// Rivy, the read-only assistant (D-016). The conversation lives only in this
// page's memory: reloading it starts again.
export default function RivyPage() {
  return (
    <main className="shell">
      <section className="page-head">
        <div>
          <p className="eyebrow">Assistant/</p>
          <h1>
            Rivy<span className="dot">.</span>
          </h1>
          <p className="page-meta">Read-only answers about the synthetic demo data, built from the app&apos;s own records.</p>
        </div>
      </section>
      <p className="note rivy-terms">
        <Icon name="info" />
        <span>
          Questions and answers go to Google Gemini (free tier), where they may be used to improve Google&apos;s products and read by reviewers.
          Do not type personal or sensitive information.
        </span>
      </p>
      <RivyChat />
    </main>
  );
}
