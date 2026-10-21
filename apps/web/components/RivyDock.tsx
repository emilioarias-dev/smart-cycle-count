'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { type Box, type Point, clampOffset, isDrag } from '../lib/rivy-drag';
import { Icon } from './Icon';
import { RivyAvatar } from './RivyAvatar';
import { RivyChat } from './RivyChat';
import { useRivy } from './RivyProvider';

// Rivy from any page: a floating button and a panel with the same
// conversation as /rivy. From 1100 px wide the panel is docked at the right
// and the page narrows beside it (nothing is covered); below that it is a
// modal drawer, nearly full screen on phones. The button is hidden on /rivy
// and while a count is being entered (Rivy stays in the navigation). It can
// be dragged aside (finger or mouse); a tap, a click or the keyboard opens
// the panel, a drag only moves it. The position is kept while navigating,
// kept on screen above the bars, and reset from the panel.
const WIDE = '(min-width: 1100px)';

function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

// Where the button may go: the screen less 8 px, under the top bar and above
// the phone tab bar.
function dragArea(): Box {
  const margin = 8;
  const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
  const tabbar = document.querySelector('.tabbar');
  const bottom = tabbar && tabbar.getClientRects().length > 0 ? tabbar.getBoundingClientRect().top : window.innerHeight;
  return { left: margin, top: Math.max(top, 0) + margin, right: document.documentElement.clientWidth - margin, bottom: bottom - margin };
}

// The button's box at offset 0 (its corner), from its box now.
function homeBox(el: HTMLElement, offset: Point): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left - offset.x, top: r.top - offset.y, right: r.right - offset.x, bottom: r.bottom - offset.y };
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function RivyDock() {
  const { open, setOpen, unread, pending, countActive } = useRivy();
  const pathname = usePathname();
  const wide = useWide();
  const onRivyPage = pathname === '/rivy';
  const docked = open && wide && !onRivyPage;
  const modal = open && !wide && !onRivyPage;
  const showButton = !onRivyPage && !countActive && !open;
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);
  const lastPath = useRef(pathname);
  // Offset from the button's corner; kept while navigating (this component
  // stays mounted), reset from the panel.
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; type: string; x: number; y: number; from: Point; home: Box; moved: boolean } | null>(null);
  const ignoreClick = useRef(false);
  const moved = offset.x !== 0 || offset.y !== 0;

  // Back inside the screen when it changes size or orientation, and when the
  // button comes back (after a count or /rivy).
  useEffect(() => {
    if (!showButton) {
      return;
    }
    const fit = () =>
      setOffset((current) => {
        const el = button.current;
        if (!el) {
          return current;
        }
        const next = clampOffset(current, homeBox(el, current), dragArea());
        return next.x === current.x && next.y === current.y ? current : next;
      });
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', fit);
    };
  }, [showButton]);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    ignoreClick.current = false;
    if (event.button !== 0) {
      return;
    }
    drag.current = { id: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY, from: offset, home: homeBox(event.currentTarget, offset), moved: false };
    // The pointer stays with the button even when it moves off it, so a fast
    // mouse drag is still seen; a release on it is still a click.
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) {
      return;
    }
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.moved) {
      if (!isDrag(dx, dy, d.type)) {
        return;
      }
      d.moved = true;
      setDragging(true);
    }
    setOffset(clampOffset({ x: d.from.x + dx, y: d.from.y + dy }, d.home, dragArea()));
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) {
      return;
    }
    // The click that follows a drag does not open the panel.
    ignoreClick.current = d.moved && event.type === 'pointerup';
    drag.current = null;
    setDragging(false);
  }

  function onClick() {
    if (ignoreClick.current) {
      ignoreClick.current = false;
      return;
    }
    setOpen(true);
  }

  // A modal panel closes when a link inside it is followed, and when a count
  // form opens; the docked panel stays.
  useEffect(() => {
    if (lastPath.current !== pathname) {
      lastPath.current = pathname;
      if (!wide) {
        setOpen(false);
      }
    }
  }, [pathname, wide, setOpen]);
  useEffect(() => {
    if (countActive && !wide) {
      setOpen(false);
    }
  }, [countActive, wide, setOpen]);

  // Opening moves the focus into the panel: to the question when docked, to
  // the title in the modal (a text field would open a phone's keyboard).
  // Closing with the button or Esc returns it to the floating button.
  const shown = docked || modal;
  useEffect(() => {
    if (shown) {
      panel.current?.querySelector<HTMLElement>(modal ? '#rivy-panel-title' : '#rivy-question')?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      button.current?.focus();
    }
  }, [shown, modal]);

  function close() {
    returnFocus.current = true;
    setOpen(false);
  }

  // While the panel is modal, the rest of the page is inert: no focus, no
  // clicks, hidden from screen readers. Restored when it closes.
  useEffect(() => {
    if (!modal) {
      return;
    }
    const others = [...document.body.children].filter(
      (el): el is HTMLElement => el instanceof HTMLElement && !el.classList.contains('rivy-panel') && !el.classList.contains('rivy-backdrop') && !el.inert,
    );
    others.forEach((el) => (el.inert = true));
    return () => others.forEach((el) => (el.inert = false));
  }, [modal]);

  // Esc closes the panel wherever the focus is (also while Rivy answers).
  useEffect(() => {
    if (!shown) {
      return;
    }
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        returnFocus.current = true;
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [shown, setOpen]);

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    // A modal panel keeps the focus inside.
    if (modal && event.key === 'Tab' && panel.current) {
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items.at(-1);
      // From the title (focused on opening) or from either end, wrap around.
      const outside = !items.includes(document.activeElement as HTMLElement);
      if (event.shiftKey && (outside || document.activeElement === first)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (outside || document.activeElement === last)) {
        event.preventDefault();
        first?.focus();
      }
    }
  }

  const state = unread ? ', new answer' : pending ? ', answering' : '';
  return (
    <>
      {showButton && (
        <>
          {/* Room at the end of the page, so nothing stays under the button. */}
          <div className="rivy-button-space" aria-hidden="true" />
          <button
            ref={button}
            type="button"
            className={`rivy-button${pending ? ' busy' : ''}${dragging ? ' dragging' : ''}${moved ? ' moved' : ''}`}
            style={moved ? { translate: `${offset.x}px ${offset.y}px` } : undefined}
            aria-label={`Open Rivy assistant${state}`}
            aria-expanded={false}
            aria-controls="rivy-panel"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onClick={onClick}
          >
            <RivyAvatar size={34} />
            <span className="rivy-button-tip" aria-hidden="true">
              Ask Rivy
            </span>
            {unread && <span className="rivy-button-dot" aria-hidden="true" />}
          </button>
        </>
      )}
      {modal && <div className="rivy-backdrop" aria-hidden="true" onClick={close} />}
      {shown && (
        <div
          ref={panel}
          id="rivy-panel"
          className={`rivy-panel ${docked ? 'docked' : 'modal'}`}
          role={modal ? 'dialog' : 'complementary'}
          aria-modal={modal || undefined}
          aria-labelledby="rivy-panel-title"
          onKeyDown={onKey}
        >
          <header className="rivy-panel-head">
            <RivyAvatar size={30} />
            <div className="grow">
              <h2 id="rivy-panel-title" tabIndex={-1}>
                Rivy
              </h2>
              <p className="subline">Read-only · synthetic demo data</p>
            </div>
            {moved && (
              <button type="button" className="icon-btn" aria-label="Put Rivy's button back in its corner" title="Put the button back" onClick={() => setOffset({ x: 0, y: 0 })}>
                <Icon name="home" />
              </button>
            )}
            <Link className="icon-btn" href="/rivy" aria-label="Open Rivy's full page" title="Open full page">
              <Icon name="expand" />
            </Link>
            <button type="button" className="icon-btn" aria-label="Close Rivy" title="Close (Esc)" onClick={close}>
              <Icon name="x" />
            </button>
          </header>
          <div className="rivy-panel-body">
            <p className="note rivy-terms">
              <Icon name="info" />
              <span>Sent to Google Gemini (free tier). Do not type personal or sensitive information.</span>
            </p>
            <RivyChat />
          </div>
        </div>
      )}
    </>
  );
}
