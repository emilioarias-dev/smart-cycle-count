'use client';

import Link from 'next/link';
import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useRef, useState, useTransition } from 'react';
import { askRivyAction } from '../app/actions';
import type { RivyAnswer, RivyExchange } from '../lib/api';
import { utcDateTime } from '../lib/format';
import { Icon } from './Icon';

// The conversation, in this page's memory only. Rivy is sent the last six
// complete exchanges with each question; older ones are dropped here too.
const WINDOW = 6;
const MAX_CHARS = 500;

const SUGGESTIONS = [
  'Why does bin B-02-03 have its priority?',
  'Compare A-02-01 and B-01-05: which one comes first, and why?',
  'What were the results of the counts of B-02-03?',
  'How is the risk score calculated?',
];

type Exchange = { question: string; answer: RivyAnswer };
type Failure = { question: string; code: string; message: string; retryable: boolean };

export function RivyChat() {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [dropped, setDropped] = useState(false);
  const [draft, setDraft] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pending, startTransition] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pending) {
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [pending]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [exchanges, failure, asking]);

  function send(question: string) {
    const text = question.trim();
    if (!text || pending) {
      return;
    }
    const history: RivyExchange[] = exchanges.map((e) => ({ question: e.question, answer: e.answer.answer }));
    setFailure(null);
    setAsking(text);
    setElapsed(0);
    startTransition(async () => {
      const outcome = await askRivyAction(text, history);
      setAsking(null);
      if (outcome.status === 'ok') {
        const next = [...exchanges, { question: text, answer: outcome.data }];
        setDropped(dropped || next.length > WINDOW);
        setExchanges(next.slice(-WINDOW));
        setDraft('');
      } else {
        setFailure({ question: text, code: outcome.code, message: outcome.message, retryable: outcome.retryable });
      }
    });
  }

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
          <article key={`${i}-${e.question}`} className="rivy-exchange">
            <p className="rivy-question">{e.question}</p>
            <div className="rivy-answer">
              <p className="rivy-text">{withLinks(e.answer.answer, e.answer.references)}</p>
              {e.answer.truncated && <p className="note">The answer reached its length limit and may be cut.</p>}
              {e.answer.references.length > 0 && (
                <p className="rivy-refs">
                  {e.answer.references.map((r) => (
                    <Link key={r.href} className="chip rivy-ref" href={r.href}>
                      {r.label}
                    </Link>
                  ))}
                </p>
              )}
              <p className="subline rivy-meta">
                {e.answer.queriedAt ? `Data as of ${utcDateTime(e.answer.queriedAt)}` : 'No app data read'} ·{' '}
                {e.answer.tools.length > 0 ? `read: ${e.answer.tools.map((t) => t.name).join(', ')}` : 'no tools'} · {e.answer.usage.modelCalls} Gemini{' '}
                {e.answer.usage.modelCalls === 1 ? 'call' : 'calls'} · {e.answer.usage.totalTokens} tokens · {(e.answer.ms / 1000).toFixed(1)} s
              </p>
            </div>
          </article>
        ))}
        {asking && (
          <article className="rivy-exchange">
            <p className="rivy-question">{asking}</p>
            <p className="rivy-answer rivy-waiting" role="status">
              <span className="spinner" aria-hidden="true" />
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
          disabled={pending}
        />
        <div className="rivy-actions">
          <span className="subline">
            {draft.length}/{MAX_CHARS} · Enter to send, Shift + Enter for a new line
          </span>
          <button
            type="button"
            className="btn btn-text"
            disabled={pending || (exchanges.length === 0 && !failure)}
            onClick={() => {
              setExchanges([]);
              setFailure(null);
              setDropped(false);
            }}
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
