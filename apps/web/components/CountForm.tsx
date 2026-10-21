'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState, useTransition } from 'react';
import { submitCountAction } from '../app/actions';
import type { CountOutcome, CountPayload, CountSheet, CountView, ExpectedLine, ProductRef, ScoreSummary } from '../lib/api';
import { plural, utcDateTime } from '../lib/format';
import { Icon } from './Icon';
import { useRivy } from './RivyProvider';

// The count form (D-001, D-003, D-012). Quantities start empty and must be
// typed for every expected pallet. After an inventory change the previous
// attempt stays visible as a draft, and the updated recount starts empty
// again: nothing is copied or sent automatically.

type Active = { inventoryVersion: number; lines: ExpectedLine[] };
type UnexpectedRow = { key: number; code: string; quantity: string; productSku: string };
type Draft = {
  lines: ExpectedLine[];
  counted: Record<string, string>;
  unexpected: UnexpectedRow[];
  conflict: Extract<CountOutcome, { status: 'inventory-changed' }>;
};

const MAX_UNEXPECTED = 10;

export function CountForm({ sheet }: { sheet: CountSheet }) {
  const [active, setActive] = useState<Active>({ inventoryVersion: sheet.inventoryVersion, lines: sheet.lines });
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [unexpected, setUnexpected] = useState<UnexpectedRow[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [outcome, setOutcome] = useState<CountOutcome | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, startTransition] = useTransition();
  // The count as it was sent last time. When its result is unknown, "Send the
  // same count again" resends exactly this, never what the fields show now.
  const [sent, setSent] = useState<CountPayload | null>(null);
  // After an unknown result the fields stay as sent until the operator
  // chooses to change them: a change is a new submission, not a retry.
  const [changing, setChanging] = useState(false);
  const unknown = outcome?.status === 'unconfirmed' && sent !== null;
  const locked = pending || (unknown && !changing);

  const productBySku = new Map(sheet.products.map((p) => [p.sku, p]));

  // While quantities are being entered, Rivy's floating button steps aside
  // (it would sit next to the form's actions); the navigation still has Rivy.
  const { setCountActive } = useRivy();
  const counting = outcome?.status !== 'saved' && outcome?.status !== 'already-counted';
  useEffect(() => {
    setCountActive(counting);
    return () => setCountActive(false);
  }, [counting, setCountActive]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) {
      // While the result is unknown, the bar's button resends the same count.
      if (unknown && !pending) {
        send(sent!);
      }
      return;
    }
    send({
      inventoryVersion: active.inventoryVersion,
      lines: active.lines.map((line) => ({ palletCode: line.palletCode, countedQuantity: asNumber(counted[line.palletCode] ?? '') })),
      unexpected: unexpected.map((row) => ({ code: row.code, quantity: asNumber(row.quantity), productSku: row.productSku || null })),
    });
  }

  function send(payload: CountPayload) {
    if (pending) {
      return;
    }
    setSent(payload);
    setChanging(false);
    startTransition(async () => {
      let result: CountOutcome;
      try {
        result = await submitCountAction(sheet.task.id, payload);
      } catch {
        // The app server did not answer: the count may or may not be saved.
        result = {
          status: 'unconfirmed',
          message: 'The app did not answer. It is not known whether the count was saved. Send the same count again: if it was saved, you will see the saved result.',
        };
      }
      if (result.status === 'inventory-changed') {
        setDraft({ lines: active.lines, counted, unexpected, conflict: result });
      }
      setOutcome(result);
    });
  }

  // The operator chooses to recount with the current inventory: an empty
  // form with the new lines and version.
  function startRecount() {
    if (outcome?.status !== 'inventory-changed') {
      return;
    }
    setActive({ inventoryVersion: outcome.inventoryVersion, lines: outcome.lines });
    setCounted({});
    setUnexpected([]);
    setOutcome(null);
  }

  if (outcome?.status === 'saved') {
    return <CountResultView count={outcome.count} recovered={outcome.recovered} score={outcome.score} />;
  }
  if (outcome?.status === 'already-counted') {
    return (
      <div className="stack" style={{ paddingBottom: 0 }}>
        <section className="callout error" role="alert">
          <h2>Already counted</h2>
          <p>{outcome.message}</p>
        </section>
        <CountResultView count={outcome.count} recovered={false} score={null} />
      </div>
    );
  }

  const conflict = outcome?.status === 'inventory-changed' ? outcome : null;
  // A typed 0 is an answer; only an empty field still needs a quantity.
  const quantities = [...active.lines.map((line) => counted[line.palletCode] ?? ''), ...unexpected.map((row) => row.quantity)];
  const missing = quantities.filter((value) => value.trim() === '').length;

  return (
    <div className="count-form">
      {draft && <DraftView draft={draft} open={conflict !== null} />}

      {conflict ? (
        <section className="callout error" role="alert">
          <h2>The inventory changed</h2>
          <p>{conflict.message}</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={startRecount}>
            Start updated recount
            <Icon name="arrow" className="arrow" />
          </button>
        </section>
      ) : (
        <form className="count-form" onSubmit={submit}>
          {draft && (
            <p className="callout info" role="status">
              Updated recount: enter every quantity again. The previous attempt above was not saved.
            </p>
          )}
          {outcome && outcome.status === 'rejected' && (
            <section className="callout error" role="alert">
              <h2>Not saved</h2>
              <p>{outcome.message}</p>
            </section>
          )}
          {outcome && outcome.status === 'unconfirmed' && (
            <section className="callout info" role="alert">
              <h2>Result unknown</h2>
              <p>{outcome.message}</p>
              {changing ? (
                <p>
                  Changed quantities are a new count: if the first one was saved, it is kept and the new quantities are rejected.
                </p>
              ) : (
                <>
                  <p>The quantities below are the ones sent, kept as they were.</p>
                  <button type="button" className="btn btn-text btn-sm" onClick={() => setChanging(true)} disabled={pending}>
                    Change quantities
                  </button>
                </>
              )}
            </section>
          )}

          <section className="panel" aria-labelledby="expected-title">
            <div className="panel-head">
              <h2 id="expected-title">
                Expected pallets<span className="dot">.</span>
              </h2>
              <p className="panel-sub">Enter the units counted for each pallet; 0 for a pallet you cannot find.</p>
            </div>
            <div className="panel-body">
              {active.lines.length === 0 ? (
                <p className="muted">The system expects this bin to be empty.</p>
              ) : (
                <ul className="count-lines">
                  {active.lines.map((line) => {
                    const id = `counted-${line.palletCode}`;
                    return (
                      <li key={line.palletCode} className="count-line">
                        <div>
                          <span className="code">{line.palletCode}</span>
                          <span className="subline">
                            {line.product.name} · {line.product.sku}
                          </span>
                          <span className="subline">
                            Expected <b className="num">{plural(line.expectedQuantity, line.product.unit)}</b>
                          </span>
                        </div>
                        <div>
                          <label className="field-label" htmlFor={id}>
                            Counted ({line.product.unit})
                          </label>
                          <input
                            id={id}
                            className="input num"
                            type="number"
                            inputMode="numeric"
                            min={0}
                            step={1}
                            required
                            value={counted[line.palletCode] ?? ''}
                            readOnly={locked}
                            onChange={(e) => setCounted({ ...counted, [line.palletCode]: e.target.value })}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          <section className="panel" aria-labelledby="unexpected-title">
            <div className="panel-head">
              <h2 id="unexpected-title">
                Unexpected pallets<span className="dot">.</span>
              </h2>
              <p className="panel-sub">Any unexpected pallet makes the count FAIL. Recording it never changes the inventory.</p>
            </div>
            <div className="panel-body">
              {unexpected.length === 0 && <p className="muted">None found.</p>}
              {unexpected.map((row) => {
                const product = productBySku.get(row.productSku);
                const update = (change: Partial<UnexpectedRow>) => setUnexpected(unexpected.map((r) => (r.key === row.key ? { ...r, ...change } : r)));
                return (
                  <div key={row.key} className="unexpected">
                    <div>
                      <label className="field-label" htmlFor={`unexpected-code-${row.key}`}>
                        Pallet code
                      </label>
                      <input
                        id={`unexpected-code-${row.key}`}
                        className="input"
                        value={row.code}
                        required
                        maxLength={40}
                        autoCapitalize="characters"
                        readOnly={locked}
                        onChange={(e) => update({ code: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="field-label" htmlFor={`unexpected-product-${row.key}`}>
                        Product
                      </label>
                      <select
                        id={`unexpected-product-${row.key}`}
                        className="input"
                        value={row.productSku}
                        aria-disabled={locked || undefined}
                        onChange={(e) => !locked && update({ productSku: e.target.value })}
                      >
                        <option value="">Product unknown</option>
                        {sheet.products.map((p) => (
                          <option key={p.sku} value={p.sku}>
                            {p.name} ({p.sku})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="field-label" htmlFor={`unexpected-quantity-${row.key}`}>
                        {product ? `Quantity (${product.unit})` : 'Units declared'}
                      </label>
                      <input
                        id={`unexpected-quantity-${row.key}`}
                        className="input num"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        required
                        value={row.quantity}
                        readOnly={locked}
                        onChange={(e) => update({ quantity: e.target.value })}
                      />
                    </div>
                    <button type="button" className="btn btn-text remove" disabled={locked} onClick={() => setUnexpected(unexpected.filter((r) => r.key !== row.key))}>
                      Remove
                    </button>
                    {!product && <p className="field-hint">Product unknown: the quantity is kept as declared, without a catalog unit.</p>}
                  </div>
                );
              })}
              <button
                type="button"
                className="btn btn-outline btn-sm"
                style={{ marginTop: '1rem' }}
                disabled={locked || unexpected.length >= MAX_UNEXPECTED}
                onClick={() => {
                  setUnexpected([...unexpected, { key: nextKey, code: '', quantity: '', productSku: '' }]);
                  setNextKey(nextKey + 1);
                }}
              >
                <Icon name="plus" />
                Add unexpected pallet
              </button>
            </div>
          </section>

          <div className="submit-bar">
            <span className="subline hide-sm">
              {quantities.length === 0
                ? 'Nothing expected and nothing found: submit to record an empty bin.'
                : missing > 0
                  ? `${missing} of ${plural(quantities.length, 'pallet')} still ${missing === 1 ? 'needs' : 'need'} a quantity`
                  : quantities.length === 1
                    ? 'The quantity is entered'
                    : `All ${quantities.length} quantities entered`}
            </span>
            <button type="submit" className="btn btn-primary" aria-disabled={pending || undefined} aria-busy={pending}>
              {pending && <span className="spinner" aria-hidden="true" />}
              {pending ? 'Saving…' : unknown && !changing ? 'Send the same count again' : 'Submit count'}
              {!pending && <Icon name="arrow" className="arrow" />}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// The attempt that was not saved, with what changed since it was opened.
function DraftView({ draft, open }: { draft: Draft; open: boolean }) {
  const { conflict } = draft;
  const before = new Map(draft.lines.map((l) => [l.palletCode, l]));
  const now = new Map(conflict.lines.map((l) => [l.palletCode, l]));
  return (
    <details className="panel draft" open={open}>
      <summary className="panel-head">Previous attempt (not saved)</summary>
      <div className="panel-body">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Pallet</th>
              <th scope="col" className="right">
                Expected then
              </th>
              <th scope="col" className="right">
                Entered
              </th>
            </tr>
          </thead>
          <tbody>
            {draft.lines.map((line) => (
              <tr key={line.palletCode}>
                <td className="code">{line.palletCode}</td>
                <td className="right num">{plural(line.expectedQuantity, line.product.unit)}</td>
                <td className="right num">{draft.counted[line.palletCode] || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {draft.unexpected.length > 0 && (
          <p className="muted">Unexpected entered: {draft.unexpected.map((u) => `${u.code || '?'} (${u.quantity || '?'})`).join(', ')}</p>
        )}
        <h3 className="eyebrow" style={{ marginTop: '1rem' }}>
          Changes since the count was opened/
        </h3>
        <ul className="changes">
          {conflict.changes.map((c) => (
            <li key={c.palletCode}>
              <strong>{c.palletCode}</strong>:{' '}
              {c.change === 'added'
                ? `new in the bin (${describe(now.get(c.palletCode))})`
                : c.change === 'removed'
                  ? 'no longer in the bin'
                  : `changed (was ${before.get(c.palletCode)?.expectedQuantity ?? '?'}, now ${describe(now.get(c.palletCode))})`}
            </li>
          ))}
          {conflict.unexpectedNowExpected.map((code) => (
            <li key={`unexpected-${code}`}>
              <strong>{code}</strong>: entered as unexpected, now expected in the bin; count it on its own line.
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function CountResultView({ count, recovered, score }: { count: CountView; recovered: boolean; score: ScoreSummary | null }) {
  // The form is gone once the server confirmed the count: the focus moves to
  // its result, so keyboard and screen reader users land on it.
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, []);
  return (
    <section className="panel" aria-labelledby="count-result-title">
      <div className="result-head">
        <span className={`result-badge pop ${count.result.toLowerCase()}`}>
          <Icon name={count.result === 'PASS' ? 'check' : 'x'} />
          {count.result}
        </span>
        <h2 id="count-result-title" ref={title} tabIndex={-1}>
          Bin {count.bin.code} counted<span className="dot">.</span>
        </h2>
        <span className="subline num">{utcDateTime(count.countedAt)}</span>
      </div>
      <div className="panel-body">
        {recovered && (
          <div className="toast info" role="status" style={{ marginTop: '0.8rem' }}>
            <Icon name="info" />
            <span>
              <b>Recovered</b>This count had already been saved. Nothing was saved or recomputed again.
            </span>
          </div>
        )}
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Pallet</th>
              <th scope="col" className="right">
                Expected
              </th>
              <th scope="col" className="right">
                Counted
              </th>
              <th scope="col" className="right">
                Variance
              </th>
            </tr>
          </thead>
          <tbody>
            {count.lines.map((line) => (
              <tr key={line.palletCode}>
                <td>
                  <span className="code">{line.palletCode}</span>
                  <span className="subline">
                    {line.product.name} · {line.product.sku}
                  </span>
                </td>
                <td className="right num">
                  <Quantity value={line.expectedQuantity} unit={line.product.unit} />
                </td>
                <td className="right num">
                  <Quantity value={line.countedQuantity} unit={line.product.unit} />
                </td>
                <td className={`right num${line.variance === 0 ? '' : ' variance-bad'}`}>
                  <Quantity value={line.variance} unit={line.product.unit} signed />
                </td>
              </tr>
            ))}
            {count.lines.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No pallets expected.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {count.unexpected.length > 0 && (
          <>
            <h3 className="eyebrow" style={{ marginTop: '1.2rem' }}>
              Unexpected pallets/
            </h3>
            <ul className="changes">
              {count.unexpected.map((u) => (
                <li key={u.code}>
                  <strong>{u.code}</strong>: {unexpectedLabel(u.quantity, u.product)}
                </li>
              ))}
            </ul>
          </>
        )}
        {score && (
          <p style={{ margin: '1.1rem 0 0' }}>
            Bin score now:{' '}
            <span className={`chip ${score.priority}`}>
              <b className="num">{score.value}</b> {score.label}
            </span>
          </p>
        )}
        <div className="actions" style={{ marginTop: '1.2rem' }}>
          <Link className="btn btn-primary" href="/count">
            Count another bin
            <Icon name="arrow" className="arrow" />
          </Link>
          <Link className="btn btn-outline" href="/tasks">
            Tasks
          </Link>
          <Link className="btn btn-text" href={`/bins/${count.bin.code}`}>
            Bin {count.bin.code}
          </Link>
        </div>
      </div>
    </section>
  );
}

// A quantity with its product unit: "33 cases", "−2 cases", "1 bag".
function Quantity({ value, unit, signed = false }: { value: number; unit: string; signed?: boolean }) {
  const words = plural(Math.abs(value), unit).split(' ');
  const sign = signed && value > 0 ? '+' : value < 0 ? '−' : '';
  return (
    <>
      {sign}
      {words[0]} <span className="unit">{words.slice(1).join(' ')}</span>
    </>
  );
}

function unexpectedLabel(quantity: number, product: ProductRef | null): string {
  return product
    ? `${plural(quantity, product.unit)} of ${product.name} (${product.sku})`
    : `${quantity} units declared, product unknown (catalog unit not identified)`;
}

function describe(line: ExpectedLine | undefined): string {
  return line ? plural(line.expectedQuantity, line.product.unit) : '?';
}

// A whole number as a number; anything else as typed, for the API to reject.
function asNumber(value: string): unknown {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}
