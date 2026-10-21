'use client';

import { type ReactNode, createContext, useCallback, useContext, useMemo, useRef, useState, useTransition } from 'react';
import { askRivyAction } from '../app/actions';
import type { RivyAnswer, RivyExchange } from '../lib/api';

// Rivy's conversation for the whole app (D-016): the /rivy page and the
// floating panel show the same one. It lives in the browser's memory only:
// it survives navigation (the root layout keeps this provider mounted) and
// is lost on reload. The last six complete exchanges are sent with each
// question; older ones are dropped here too.
export const WINDOW = 6;
export const MAX_CHARS = 500;

export type Exchange = { question: string; answer: RivyAnswer };
export type Failure = { question: string; code: string; message: string; retryable: boolean };

type Rivy = {
  exchanges: Exchange[];
  dropped: boolean;
  failure: Failure | null;
  asking: string | null;
  startedAt: number | null;
  pending: boolean;
  draft: string;
  setDraft: (draft: string) => void;
  send: (question: string) => void;
  clear: () => void;
  // The floating panel.
  open: boolean;
  setOpen: (open: boolean) => void;
  // An answer (or a failure) arrived while the panel was closed.
  unread: boolean;
  // A count form is open: the floating button steps aside (Rivy stays in the
  // navigation).
  countActive: boolean;
  setCountActive: (active: boolean) => void;
};

const RivyContext = createContext<Rivy | null>(null);

export function RivyProvider({ children }: { children: ReactNode }) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [dropped, setDropped] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [open, setOpenState] = useState(false);
  const [unread, setUnread] = useState(false);
  const [countActive, setCountActive] = useState(false);
  const [pending, startTransition] = useTransition();
  // Read when an answer arrives, after the user may have closed the panel.
  const openRef = useRef(false);
  const onRivyPage = () => typeof window !== 'undefined' && window.location.pathname === '/rivy';

  const setOpen = useCallback((value: boolean) => {
    openRef.current = value;
    setOpenState(value);
    if (value) {
      setUnread(false);
    }
  }, []);

  const send = useCallback(
    (question: string) => {
      const text = question.trim();
      if (!text || pending) {
        return;
      }
      const history: RivyExchange[] = exchanges.map((e) => ({ question: e.question, answer: e.answer.answer }));
      setFailure(null);
      setAsking(text);
      setStartedAt(Date.now());
      startTransition(async () => {
        let outcome: Awaited<ReturnType<typeof askRivyAction>>;
        try {
          outcome = await askRivyAction(text, history);
        } catch {
          // The Next.js server itself did not answer (for example, stopped).
          outcome = { status: 'error', code: 'APP_UNREACHABLE', message: 'The app server did not answer. Check that it is running, then try again.', retryable: true };
        }
        setAsking(null);
        setStartedAt(null);
        if (outcome.status === 'ok') {
          const next = [...exchanges, { question: text, answer: outcome.data }];
          setDropped((was) => was || next.length > WINDOW);
          setExchanges(next.slice(-WINDOW));
          setDraft('');
        } else {
          setFailure({ question: text, code: outcome.code, message: outcome.message, retryable: outcome.retryable });
        }
        if (!openRef.current && !onRivyPage()) {
          setUnread(true);
        }
      });
    },
    [exchanges, pending],
  );

  const clear = useCallback(() => {
    setExchanges([]);
    setFailure(null);
    setDropped(false);
  }, []);

  const value = useMemo(
    () => ({ exchanges, dropped, failure, asking, startedAt, pending, draft, setDraft, send, clear, open, setOpen, unread, countActive, setCountActive }),
    [exchanges, dropped, failure, asking, startedAt, pending, draft, send, clear, open, setOpen, unread, countActive],
  );
  return <RivyContext.Provider value={value}>{children}</RivyContext.Provider>;
}

export function useRivy(): Rivy {
  const rivy = useContext(RivyContext);
  if (!rivy) {
    throw new Error('useRivy must be used inside RivyProvider (app/layout.tsx).');
  }
  return rivy;
}
