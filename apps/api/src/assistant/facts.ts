import type { ToolResult } from './tools.js';

// The records an answer was built from, as the API read them (D-016). The
// page shows them under the answer, so scores, bands, times and count
// results never depend on the model's wording.

type Score = { value: number; band: string; scoreTime: string | null };
export type Fact =
  | { kind: 'bin'; code: string; score: Score | null; factors: { factor: string; input: string; points: number }[]; lastAudit: string | null; pallets: number; pendingPlan: number | null }
  | { kind: 'missing'; message: string }
  | { kind: 'compare'; first: string | null; decidedBy: string; bins: { code: string; score: Score | null; forNewPlan: string }[] }
  | { kind: 'top'; bins: { rank: number; code: string; score: Score }[] }
  | {
      kind: 'history';
      code: string;
      current: { value: number; scoreTime: string | null } | null;
      note: string | null;
      tasks: {
        planId: number;
        status: string;
        atSelection: Score;
        count: { result: string; countedAt: string | null; lines: { pallet: string; sku: string; unit: string; expected: number; counted: number; variance: number }[]; unexpected: number } | null;
      }[];
    }
  | { kind: 'rules'; version: string };

type Any = Record<string, any>;

const score = (s: Any | null | undefined): Score | null => (s ? { value: s.value, band: s.band, scoreTime: s.scoreTime ?? null } : null);

export function factsOf(name: string, r: ToolResult): Fact[] {
  const x = r as Any;
  if (x.error) {
    return [];
  }
  if (x.found === false) {
    return [{ kind: 'missing', message: String(x.message ?? 'Not found.') }];
  }
  switch (name) {
    case 'get_bin':
      return [
        {
          kind: 'bin',
          code: x.code,
          score: score(x.currentScore),
          factors: (x.currentScore?.factors ?? []).map((f: Any) => ({ factor: f.factor, input: String(f.input), points: f.points })),
          lastAudit: x.lastAudit?.date ?? null,
          pallets: x.palletCount,
          pendingPlan: x.pendingTask?.planId ?? null,
        },
      ];
    case 'compare_bins':
      return [{ kind: 'compare', first: x.higherPriority ?? null, decidedBy: x.decidedBy, bins: x.bins.map((b: Any) => ({ code: b.code, score: score(b.currentScore), forNewPlan: b.forNewPlan })) }];
    case 'get_top_bins':
      return [{ kind: 'top', bins: x.bins.map((b: Any) => ({ rank: b.rank, code: b.code, score: { value: b.currentScore, band: b.band, scoreTime: b.scoreTime } })) }];
    case 'get_bin_history':
      return [
        {
          kind: 'history',
          code: x.code,
          current: x.currentScore ?? null,
          note: x.note ?? null,
          tasks: x.tasks.map((t: Any) => ({
            planId: t.planId,
            status: t.status,
            atSelection: score(t.scoreAtSelection)!,
            count: t.count ? { result: t.count.result, countedAt: t.count.countedAt, lines: t.count.lines, unexpected: t.count.unexpectedPallets.length } : null,
          })),
        },
      ];
    case 'get_rules':
      return [{ kind: 'rules', version: x.rulesVersion }];
    default:
      return [];
  }
}
