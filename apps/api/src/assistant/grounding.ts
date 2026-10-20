// Rivy's answers may only state what this question's tool results contain
// (D-016). Bin, pallet and product codes, link paths, dates, times and
// numbers in the answer are looked up in those results (and in the question
// itself); earlier answers in the conversation are not a source. Whatever is
// not found is returned, and the answer is not shown.

const BIN = /\b[A-Z]-\d{2}-\d{2}\b/g;
const IDS = /\b(?:P-\d{4}|SKU-\d{3})\b/g;
const TIMESTAMP = /\b(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}:\d{2})(?::\d{2}(?:\.\d+)?)?Z?)?/g;
const CLOCK = /\b(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\b/g;
const PATH = /(?<![\w.:/])\/[a-z][\w-]*(?:\/[\w-]+)*/gi;
const NUMBER = /(?<![\w.,])\d+(?:[.,]\d+)?(?![\w])/g;
// Small whole numbers (list items, "2 bins", "Top 5") are not checked.
const SMALL = 10;
// Pages that exist whatever the tools returned.
const APP_PAGES = ['/', '/tasks', '/count', '/rivy'];

type Tokens = { codes: string[]; ids: string[]; stamps: { date: string; clock: string | null; text: string }[]; clocks: string[]; paths: string[]; numbers: number[] };

function tokens(text: string): Tokens {
  const stamps = [...text.matchAll(TIMESTAMP)].map((m) => ({ date: m[1], clock: m[2] ? pad(m[2]) : null, text: m[0] }));
  let rest = text.replace(TIMESTAMP, ' ');
  const paths = rest.match(PATH) ?? [];
  rest = rest.replace(PATH, ' ');
  const codes = rest.match(BIN) ?? [];
  const ids = rest.match(IDS) ?? [];
  rest = rest.replace(BIN, ' ').replace(IDS, ' ');
  const clocks = [...rest.matchAll(CLOCK)].map((m) => pad(`${m[1]}:${m[2]}`));
  rest = rest.replace(CLOCK, ' ');
  const numbers = (rest.match(NUMBER) ?? []).map((n) => Number(n.replace(',', '.')));
  return { codes, ids, stamps, clocks, paths, numbers };
}

function pad(clock: string): string {
  return clock.length === 4 ? `0${clock}` : clock;
}

function strings(value: unknown, out: string[] = [], numbers: number[] = []): { strings: string[]; numbers: number[] } {
  if (typeof value === 'string') {
    out.push(value);
  } else if (typeof value === 'number') {
    numbers.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => strings(v, out, numbers));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => strings(v, out, numbers));
  }
  return { strings: out, numbers };
}

// Returns what the answer states that the sources do not contain.
export function unsupported(answer: string, sources: unknown[], question: string): string[] {
  const found = strings([...sources, question]);
  const source = found.strings.map(tokens);
  const codes = new Set(source.flatMap((t) => [...t.codes, ...t.paths.flatMap((p) => p.match(BIN) ?? [])]));
  const ids = new Set(source.flatMap((t) => t.ids));
  const stamps = source.flatMap((t) => t.stamps);
  const paths = new Set([...APP_PAGES, ...source.flatMap((t) => t.paths)]);
  const numbers = [
    ...found.numbers,
    ...source.flatMap((t) => t.numbers),
    // A date may be written in words ("20 October 2026").
    ...stamps.flatMap((s) => s.date.split('-').map(Number)),
  ].map(Math.abs);
  const near = (n: number) => numbers.some((x) => x === n || [0, 1, 2].some((d) => Number(x.toFixed(d)) === n));

  const said = tokens(answer);
  const missing = [
    ...said.codes.filter((c) => !codes.has(c)),
    ...said.ids.filter((c) => !ids.has(c)),
    ...said.paths.filter((p) => !paths.has(p)),
    ...said.stamps.filter((s) => !stamps.some((t) => t.date === s.date && (!s.clock || t.clock === s.clock))).map((s) => s.text),
    ...said.clocks.filter((c) => !stamps.some((t) => t.clock === c)),
    ...said.numbers.map(Math.abs).filter((n) => !(Number.isInteger(n) && n <= SMALL) && !near(n)).map(String),
  ];
  return [...new Set(missing)];
}
