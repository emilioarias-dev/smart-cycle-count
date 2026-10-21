'use client';

import Link from 'next/link';
import { type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import type { RivyAnswer } from '../lib/api';
import { utcDateTime } from '../lib/format';
import { Icon } from './Icon';
import { RivyAvatar } from './RivyAvatar';
import { RivyFacts } from './RivyFacts';
import { type Exchange, MAX_CHARS, WINDOW, useRivy } from './RivyProvider';

// The conversation view: on the /rivy page and in the floating panel, both
// showing the same conversation (RivyProvider).

const SUGGESTIONS = [
  'Why does bin B-02-03 have its priority?',
  'Compare A-02-01 and B-01-05: which one comes first, and why?',
  'What were the results of the counts of B-02-03?',
  'Which bins have the highest scores?',
  'How is the risk score calculated?',
];

export function RivyChat() {
  const { exchanges, dropped, failure, asking, startedAt, pending, draft, setDraft, send, clear } = useRivy();
  const [elapsed, setElapsed] = useState(0);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (startedAt === null) {
      setElapsed(0);
      return;
    }
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [exchanges, failure, asking]);

  function submit(event: FormEvent) {
    event.preventDefault();
    send(draft);
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send(draft);
    }
  }

  return (
    <div className="rivy">
      <section className="panel rivy-log" aria-label="Conversation" aria-live="polite">
        {exchanges.length === 0 && !asking && !failure && (
          <div className="panel-body rivy-empty">
            <p>Ask about a bin&apos;s priority, compare two bins, look at count results or ask how the app works. For example:</p>
            <div className="rivy-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="btn btn-outline btn-sm rivy-suggestion" onClick={() => send(s)} disabled={pending}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {dropped && <p className="note rivy-window">Rivy keeps the last {WINDOW} exchanges; older ones were cleared.</p>}
        {exchanges.map((e, i) => (
          <ExchangeView key={`${i}-${e.question}`} exchange={e} pending={pending} onRetry={send} />
        ))}
        {asking && (
          <article className="rivy-exchange">
            <p className="rivy-question">{asking}</p>
            {/* Only the real state: the API answers once, after its checks. */}
            <p className="rivy-answer rivy-waiting" role="status">
              <span className="rivy-thinking" aria-hidden="true">
                <RivyAvatar size={28} />
              </span>
              Rivy is reading the app&apos;s records… {elapsed > 0 ? `${elapsed} s` : ''}
            </p>
          </article>
        )}
        {failure && (
          <article className="rivy-exchange">
            <p className="rivy-question">{failure.question}</p>
            <div className="callout error" role="alert">
              <h2>No answer</h2>
              <p>{failure.message}</p>
              <p className="subline">The rest of the app keeps working.</p>
              {failure.retryable && (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => send(failure.question)} disabled={pending}>
                  Try again
                </button>
              )}
            </div>
          </article>
        )}
        <div ref={end} />
      </section>

      <form className="rivy-form" onSubmit={submit}>
        <label className="field-label" htmlFor="rivy-question">
          Your question
        </label>
        <textarea
          id="rivy-question"
          className="input rivy-input"
          rows={2}
          maxLength={MAX_CHARS}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder="Why is B-02-03 a priority?"
          // Read-only, not disabled, while Rivy answers: the field keeps the focus.
          readOnly={pending}
          aria-busy={pending}
        />
        <div className="rivy-actions">
          <span className="subline">
            {draft.length}/{MAX_CHARS} · Enter to send, Shift + Enter for a new line
          </span>
          <button
            type="button"
            className="btn btn-text"
            disabled={pending || (exchanges.length === 0 && !failure)}
            onClick={clear}
          >
            Clear conversation
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending || !draft.trim()} aria-busy={pending}>
            {pending ? <span className="spinner" aria-hidden="true" /> : <Icon name="send" />}
            {pending ? 'Asking…' : 'Ask'}
          </button>
        </div>
      </form>
    </div>
  );
}

// How recent an answer must be, when shown, to be revealed progressively;
// older ones (after navigating or reopening the panel) appear at once.
const FRESH_MS = 1500;

// One exchange. A new answer, already validated and complete in the page
// (screen readers get it at once), is revealed line by line: each block
// fades in 45 ms after the previous one, at most 12 steps; nothing with
// reduced motion.
function ExchangeView({ exchange: e, pending, onRetry }: { exchange: Exchange; pending: boolean; onRetry: (question: string) => void }) {
  const [fresh] = useState(() => Date.now() - e.receivedAt < FRESH_MS);
  const lines = e.answer.withheld ? [] : e.answer.answer.split('\n');
  let step = 0;
  const next = () => ({ '--i': Math.min(step++, 12) }) as CSSProperties;
  return (
    <article className={`rivy-exchange${fresh ? ' rivy-reveal' : ''}`}>
      <p className="rivy-question">{e.question}</p>
      <div className="rivy-answer">
        {e.answer.withheld ? (
          <div className="callout info rivy-withheld rivy-step" role="note" style={next()}>
            <p>{e.answer.answer}</p>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => onRetry(e.question)} disabled={pending}>
              Try again
            </button>
          </div>
        ) : (
          <p className="rivy-text">
            {lines.map((line, i) => (
              <span key={i} className="rivy-line rivy-step" style={next()}>
                {line === '' ? ' ' : withLinks(line, e.answer.references)}
              </span>
            ))}
          </p>
        )}
        <div className="rivy-step" style={next()}>
          <RivyFacts facts={e.answer.facts} />
        </div>
        {e.answer.truncated && (
          <p className="note rivy-step" style={next()}>
            The answer reached its length limit and may be cut.
          </p>
        )}
        {e.answer.references.length > 0 && (
          <p className="rivy-refs rivy-step" style={next()}>
            {e.answer.references.map((r) => (
              <Link key={r.href} className="chip rivy-ref" href={r.href}>
                {r.label}
              </Link>
            ))}
          </p>
        )}
        <p className="subline rivy-meta rivy-step" style={next()}>
          {e.answer.queriedAt ? `Data as of ${utcDateTime(e.answer.queriedAt)}` : 'No app data read'} ·{' '}
          {e.answer.tools.length > 0 ? `read: ${e.answer.tools.map((t) => t.name).join(', ')}` : 'no tools'} · {e.answer.usage.modelCalls} Gemini{' '}
          {e.answer.usage.modelCalls === 1 ? 'call' : 'calls'} · {e.answer.usage.totalTokens} tokens · {(e.answer.ms / 1000).toFixed(1)} s
        </p>
      </div>
    </article>
  );
}

// Only paths that the backend returned with this answer become links. The
// bare "/" stays a chip only: in the text it is too often just a slash.
function withLinks(text: string, references: RivyAnswer['references']): ReactNode[] {
  const allowed = new Set(references.map((r) => r.href).filter((h) => h.length > 1));
  if (allowed.size === 0) {
    return [text];
  }
  const pattern = new RegExp(`(?<![\\w/.:-])(${[...allowed].sort((a, b) => b.length - a.length).map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w/-])`, 'g');
  return text.split(pattern).map((piece, i) =>
    allowed.has(piece) ? (
      <Link key={i} href={piece}>
        {piece}
      </Link>
    ) : (
      piece
    ),
  );
}
