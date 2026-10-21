// Rivy's answers may only state what this question's tool results contain
// (D-016). Bin, pallet and product codes, link paths, dates, times and
// numbers in the answer are looked up in those results; neither the question
// nor earlier answers are a source. A number written next to a bin code must
// belong to that bin's records. Whatever does not match is returned, and the
// answer's text is not shown.

const BIN = /\b[A-Z]-\d{2}-\d{2}\b/g;
const IDS = /\b(?:P-\d{4}|SKU-\d{3})\b/g;
const TIMESTAMP = /\b(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}:\d{2})(?::\d{2}(?:\.\d+)?)?Z?)?/g;
const CLOCK = /\b(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\b/g;
const PATH = /(?<![\w.:/])\/[a-z][\w-]*(?:\/[\w-]+)*/gi;
const NUMBER = /(?<![\w.,])\d+(?:[.,]\d+)?(?![\w])/g;
// "1. " or "- 2) " at the start of a line numbers a list; it states nothing.
const LIST_MARKER = /^(\s*(?:[-*•]\s*)?)\d+[.)](?=\s)/gm;
// Pages that exist whatever the tools returned.
const APP_PAGES = ['/', '/tasks', '/count', '/rivy'];

type Stamp = { date: string; clock: string | null; text: string };
type Pools = { global: number[]; bins: Map<string, number[]>; codes: Set<string>; ids: Set<string>; stamps: Stamp[]; paths: Set<string> };

const pad = (clock: string) => (clock.length === 4 ? `0${clock}` : clock);
const blank = (text: string, pattern: RegExp) => text.replace(pattern, (m) => ' '.repeat(m.length));
const toNumber = (n: string) => Math.abs(Number(n.replace(',', '.')));

// Codes, ids, stamps, paths and numbers of a text, with positions; dates,
// times, codes and paths are removed before numbers are read.
function scan(text: string) {
  const stamps: Stamp[] = [...text.matchAll(TIMESTAMP)].map((m) => ({ date: m[1], clock: m[2] ? pad(m[2]) : null, text: m[0] }));
  let rest = blank(text.replace(LIST_MARKER, (m, lead: string) => lead + ' '.repeat(m.length - lead.length)), TIMESTAMP);
  const paths = [...rest.matchAll(PATH)].map((m) => ({ text: m[0], index: m.index }));
  rest = blank(rest, PATH);
  const mentions = [...[...rest.matchAll(BIN)].map((m) => ({ code: m[0], index: m.index, inPath: false })), ...paths.flatMap((p) => (p.text.match(BIN) ?? []).map((code) => ({ code, index: p.index, inPath: true })))].sort(
    (a, b) => a.index - b.index,
  );
  const ids = rest.match(IDS) ?? [];
  rest = blank(blank(rest, BIN), IDS);
  const clocks = [...rest.matchAll(CLOCK)].map((m) => pad(`${m[1]}:${m[2]}`));
  rest = blank(rest, CLOCK);
  // Sentence by sentence, a number written after a bin code belongs to that
  // bin; one before any code belongs to none.
  // (Boundaries from the original text: blanked codes are spaces in `rest`.)
  const bounds = [0, ...[...text.matchAll(/\n|(?<=[.;!?])\s+/g)].map((m) => m.index + m[0].length), text.length];
  const numbers = [...rest.matchAll(NUMBER)].map((m) => {
    const start = Math.max(...bounds.filter((b) => b <= m.index));
    const owner = [...mentions].reverse().find((x) => x.index >= start && x.index < m.index);
    return { text: m[0], value: toNumber(m[0]), owner: owner?.code ?? null };
  });
  return { stamps, paths: paths.map((p) => p.text), mentions, ids, clocks, numbers };
}

// Every number of the results, under the bin whose record holds it (an
// object with a bin `code`), or global (rules, sizes, notes).
function pools(sources: unknown[]): Pools {
  const p: Pools = { global: [], bins: new Map(), codes: new Set(), ids: new Set(), stamps: [], paths: new Set(APP_PAGES) };
  const add = (owner: string | null, values: number[]) => {
    if (owner) {
      p.bins.set(owner, [...(p.bins.get(owner) ?? []), ...values]);
    } else {
      p.global.push(...values);
    }
  };
  const walk = (value: unknown, owner: string | null) => {
    if (typeof value === 'number') {
      add(owner, [Math.abs(value)]);
    } else if (typeof value === 'string') {
      const s = scan(value);
      s.mentions.forEach((m) => p.codes.add(m.code));
      s.ids.forEach((id) => p.ids.add(id));
      s.paths.forEach((path) => p.paths.add(path));
      p.stamps.push(...s.stamps);
      // A date may be written in words ("20 October 2026").
      add(owner, [...s.numbers.map((n) => n.value), ...s.stamps.flatMap((t) => t.date.split('-').map(Number))]);
      // A number written after a code in a text also belongs to that bin.
      s.numbers.filter((n) => n.owner && n.owner !== owner).forEach((n) => add(n.owner, [n.value]));
    } else if (Array.isArray(value)) {
      value.forEach((v) => walk(v, owner));
    } else if (value && typeof value === 'object') {
      const code = (value as { code?: unknown }).code;
      const own = typeof code === 'string' && new RegExp(`^${BIN.source}$`).test(code) ? code : owner;
      Object.values(value).forEach((v) => walk(v, own));
    }
  };
  sources.forEach((s) => walk(s, null));
  return p;
}

// The same value as written: exact, or rounded to 0, 1 or 2 decimals.
const holds = (list: number[], n: number) => list.some((x) => x === n || [0, 1, 2].some((d) => Number(x.toFixed(d)) === n));

// Returns what the answer states that this question's results do not contain.
export function unsupported(answer: string, sources: unknown[]): string[] {
  const p = pools(sources);
  const all = [...p.global, ...[...p.bins.values()].flat()];
  const said = scan(answer);
  const missing: string[] = [
    ...said.mentions.filter((m) => !m.inPath && !p.codes.has(m.code)).map((m) => m.code),
    ...said.ids.filter((c) => !p.ids.has(c)),
    ...said.paths.filter((path) => !p.paths.has(path)),
    ...said.stamps.filter((s) => !p.stamps.some((t) => t.date === s.date && (!s.clock || t.clock === s.clock))).map((s) => s.text),
    ...said.clocks.filter((c) => !p.stamps.some((t) => t.clock === c)),
  ];

  // A number of a bin must be that bin's; one of no bin, any result's.
  for (const n of said.numbers) {
    const owner = n.owner;
    if (!owner) {
      if (!holds(all, n.value)) {
        missing.push(n.text);
      }
      continue;
    }
    const others = [...p.bins.entries()].filter(([code]) => code !== owner).flatMap(([, values]) => values);
    const ok = holds(p.bins.get(owner) ?? [], n.value) || (holds(p.global, n.value) && !holds(others, n.value));
    if (!ok) {
      missing.push(`${n.text} for ${owner}`);
    }
  }
  return [...new Set(missing)];
}
