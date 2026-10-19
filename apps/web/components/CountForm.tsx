'use client';

import Link from 'next/link';
import { type FormEvent, useState, useTransition } from 'react';
import { submitCountAction } from '../app/actions';
import type { CountOutcome, CountPayload, CountSheet, CountView, ExpectedLine, ProductRef } from '../lib/api';
import { plural, utcDateTime } from '../lib/format';

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

  const productBySku = new Map(sheet.products.map((p) => [p.sku, p]));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload: CountPayload = {
      inventoryVersion: active.inventoryVersion,
      lines: active.lines.map((line) => ({ palletCode: line.palletCode, countedQuantity: asNumber(counted[line.palletCode] ?? '') })),
      unexpected: unexpected.map((row) => ({ code: row.code, quantity: asNumber(row.quantity), productSku: row.productSku || null })),
    };
    startTransition(async () => {
      const result = await submitCountAction(sheet.task.id, payload);
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
      <>
        <section className="card error" role="alert">
          <h2>Already counted</h2>
          <p>{outcome.message}</p>
        </section>
        <CountResultView count={outcome.count} recovered={false} score={null} />
      </>
    );
  }

  const conflict = outcome?.status === 'inventory-changed' ? outcome : null;

  return (
    <>
      {draft && <DraftView draft={draft} open={conflict !== null} />}

      {conflict ? (
        <section className="card error" role="alert">
          <h2>The inventory changed</h2>
          <p>{conflict.message}</p>
          <button type="button" className="primary" onClick={startRecount}>
            Start updated recount
          </button>
        </section>
      ) : (
        <form className="count-form" onSubmit={submit}>
          {draft && (
            <p className="card notice" role="status">
              Updated recount: enter every quantity again. The previous attempt above was not saved.
            </p>
          )}
          {outcome && (outcome.status === 'rejected' || outcome.status === 'unconfirmed') && (
            <p className={`card ${outcome.status === 'rejected' ? 'error' : 'notice'}`} role="alert">
              {outcome.message}
            </p>
          )}

          <section aria-label="Expected pallets">
            <h2>Expected pallets</h2>
            {active.lines.length === 0 ? (
              <p className="muted">The system expects this bin to be empty.</p>
            ) : (
              <ul className="count-lines">
                {active.lines.map((line) => (
                  <li key={line.palletCode} className="count-line">
                    <div>
                      <p className="pallet-code">{line.palletCode}</p>
                      <p className="pallet-product">
                        {line.product.name} <span className="muted">· {line.product.sku}</span>
                      </p>
                      <p className="muted">Expected {plural(line.expectedQuantity, line.product.unit)}</p>
                    </div>
                    <label>
                      <span>Counted ({line.product.unit})</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        required
                        value={counted[line.palletCode] ?? ''}
                        onChange={(e) => setCounted({ ...counted, [line.palletCode]: e.target.value })}
                      />
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <p className="footnote">Enter 0 for a pallet you cannot find.</p>
          </section>

          <section aria-label="Unexpected pallets">
            <h2>Unexpected pallets</h2>
            {unexpected.length === 0 && <p className="muted">None found.</p>}
            <ul className="count-lines">
              {unexpected.map((row) => {
                const product = productBySku.get(row.productSku);
                const update = (change: Partial<UnexpectedRow>) =>
                  setUnexpected(unexpected.map((r) => (r.key === row.key ? { ...r, ...change } : r)));
                return (
                  <li key={row.key} className="count-line unexpected-row">
                    <label>
                      <span>Pallet code</span>
                      <input value={row.code} required maxLength={40} autoCapitalize="characters" onChange={(e) => update({ code: e.target.value })} />
                    </label>
                    <label>
                      <span>Product</span>
                      <select value={row.productSku} onChange={(e) => update({ productSku: e.target.value })}>
                        <option value="">Product unknown</option>
                        {sheet.products.map((p) => (
                          <option key={p.sku} value={p.sku}>
                            {p.name} ({p.sku})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{product ? `Quantity (${product.unit})` : 'Quantity (units declared, product unknown)'}</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        required
                        value={row.quantity}
                        onChange={(e) => update({ quantity: e.target.value })}
                      />
                    </label>
                    <button type="button" className="link-button" onClick={() => setUnexpected(unexpected.filter((r) => r.key !== row.key))}>
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              className="secondary"
              disabled={unexpected.length >= MAX_UNEXPECTED}
              onClick={() => {
                setUnexpected([...unexpected, { key: nextKey, code: '', quantity: '', productSku: '' }]);
                setNextKey(nextKey + 1);
              }}
            >
              Add unexpected pallet
            </button>
            <p className="footnote">Any unexpected pallet makes the count FAIL. Recording it never changes the inventory.</p>
          </section>

          <button type="submit" className="primary" disabled={pending}>
            {pending ? 'Saving…' : outcome?.status === 'unconfirmed' ? 'Send the same count again' : 'Submit count'}
          </button>
        </form>
      )}
    </>
  );
}

// The attempt that was not saved, with what changed since it was opened.
function DraftView({ draft, open }: { draft: Draft; open: boolean }) {
  const { conflict } = draft;
  const before = new Map(draft.lines.map((l) => [l.palletCode, l]));
  const now = new Map(conflict.lines.map((l) => [l.palletCode, l]));
  return (
    <details className="card draft" open={open}>
      <summary>Previous attempt (not saved)</summary>
      <table className="count-table">
        <thead>
          <tr>
            <th scope="col">Pallet</th>
            <th scope="col">Expected then</th>
            <th scope="col">Entered</th>
          </tr>
        </thead>
        <tbody>
          {draft.lines.map((line) => (
            <tr key={line.palletCode}>
              <td>{line.palletCode}</td>
              <td>{line.expectedQuantity}</td>
              <td>{draft.counted[line.palletCode] || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {draft.unexpected.length > 0 && (
        <p className="muted">Unexpected entered: {draft.unexpected.map((u) => `${u.code || '?'} (${u.quantity || '?'})`).join(', ')}</p>
      )}
      <h3>Changes since the count was opened</h3>
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
    </details>
  );
}

function CountResultView({ count, recovered, score }: { count: CountView; recovered: boolean; score: { value: number; label: string; priority: string; reference: string } | null }) {
  return (
    <section className={`card count-result result-${count.result.toLowerCase()}`} aria-label="Count result">
      <p className="result-badge">{count.result}</p>
      <h2>
        Bin {count.bin.code} counted {utcDateTime(count.countedAt)}
      </h2>
      {recovered && <p role="status">Recovered: this count had already been saved. Nothing was saved or recomputed again.</p>}
      <table className="count-table">
        <thead>
          <tr>
            <th scope="col">Pallet</th>
            <th scope="col">Expected</th>
            <th scope="col">Counted</th>
            <th scope="col">Variance</th>
          </tr>
        </thead>
        <tbody>
          {count.lines.map((line) => (
            <tr key={line.palletCode}>
              <td>{line.palletCode}</td>
              <td>{line.expectedQuantity}</td>
              <td>{line.countedQuantity}</td>
              <td className={line.variance === 0 ? '' : 'variance'}>{line.variance > 0 ? `+${line.variance}` : line.variance}</td>
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
          <h3>Unexpected pallets</h3>
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
        <p>
          Bin score now:{' '}
          <span className={`score-chip priority-${score.priority}`}>
            <strong>{score.value}</strong> {score.label}
          </span>
        </p>
      )}
      <p className="result-links">
        <Link href="/count">Count another bin</Link> <Link href="/tasks">Tasks</Link> <Link href={`/bins/${count.bin.code}`}>Bin {count.bin.code}</Link>
      </p>
    </section>
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
