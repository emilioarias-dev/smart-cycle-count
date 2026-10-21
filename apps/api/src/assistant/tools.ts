import { Injectable } from '@nestjs/common';
import { BinsService } from '../bins/bins.service.js';
import { readCount } from '../counting/submit.js';
import { normalizeBinCode } from '../inventory/bin-code.js';
import { comparePriority } from '../planning/selection.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CAPS, FORMULA_VERSION, WEIGHTS, WINDOW_DAYS } from '../scoring/formula.js';
import { type ScoreDetail, scoreDetail } from '../scoring/presenter.js';
import { ScoresService, TOP_SIZE } from '../scores/scores.service.js';

// Rivy's tools (D-016). Read-only: they only read through the existing
// services and queries, never write, and never run SQL from the model.
// Every figure, time reference and link in an answer comes from here.

export const TOOL_NAMES = ['get_bin', 'compare_bins', 'get_top_bins', 'get_bin_history', 'get_rules'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

// What Gemini sees: one declaration per tool.
export const TOOL_DECLARATIONS = [
  {
    name: 'get_bin',
    description:
      "A bin's CURRENT stored risk score with its breakdown (weights, inputs, points), the time the score refers to, its last audit date, its pallets and any pending audit task. Use it for any question about a bin's priority now.",
    parameters: { type: 'object', properties: { code: { type: 'string', description: 'Bin code, e.g. B-02-03.' } }, required: ['code'] },
  },
  {
    name: 'compare_bins',
    description:
      'Compares two bins by their CURRENT stored scores: which one has the higher audit priority and which rule decides it (score, then never audited / older audit, then code), and whether each one can go into a new plan.',
    parameters: {
      type: 'object',
      properties: { first: { type: 'string', description: 'First bin code.' }, second: { type: 'string', description: 'Second bin code.' } },
      required: ['first', 'second'],
    },
  },
  {
    name: 'get_top_bins',
    description: `The ${TOP_SIZE} bins with the highest CURRENT stored scores among all bins (the dashboard's Top ${TOP_SIZE}), highest priority first in the order plans use, each with its score, band and score time. Use it for any question about which bins have the highest scores or priority overall. There is no other ranking (for example, no lowest scores).`,
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_bin_history',
    description:
      "A bin's recent audit tasks (newest first, at most 5): the score copied when each plan selected it, the task status and, if counted, the count result with expected, counted and variance per pallet. Scores are only stored as the current one and these copies.",
    parameters: { type: 'object', properties: { code: { type: 'string', description: 'Bin code, e.g. B-02-03.' } }, required: ['code'] },
  },
  {
    name: 'get_rules',
    description: "The approved rules of the app (versioned summary): the score formula and bands, Top N plans and their order, counts and results, and what Rivy can and cannot do.",
    parameters: {
      type: 'object',
      properties: { topic: { type: 'string', enum: ['score', 'plans', 'counts', 'rivy', 'all'], description: 'Which rules.' } },
      required: ['topic'],
    },
  },
] as const;

export type ToolResult = Record<string, unknown> & { links?: { label: string; href: string }[] };

const HISTORY_LIMIT = 5;
const BIN_CODE = /^[A-Z]-\d{2}-\d{2}$/;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const round2 = (n: number) => Math.round(n * 100) / 100;

export const RULES_VERSION = `2026-10-20 (score formula v${FORMULA_VERSION})`;
const RULES: Record<'score' | 'plans' | 'counts' | 'rivy', string[]> = {
  score: [
    `Risk score 0-100 = sum of four factors, rounded once: time since last audit (weight ${WEIGHTS.age}, full at ${CAPS.ageDays} days or never audited), activity = putaway, pick and move movements in the ${WINDOW_DAYS} days up to the score time (weight ${WEIGHTS.activity}, full at ${CAPS.activity}), adjustments in those days (weight ${WEIGHTS.adjustments}, full at ${CAPS.adjustments}), last count FAIL (weight ${WEIGHTS.lastResult}; PASS or no count adds 0).`,
    'Points = weight x min(input / cap, 1). Bands: High 70-100, Medium 40-69, Low 0-39. A heuristic priority for audits, not a probability of error.',
    'Only the latest score of each bin is stored ("current score", with the time it refers to). Recompute scores or a saved count rescore every bin; older scores are not kept.',
    'Last audit dates before the first count in the app are simulated demo data.',
  ],
  plans: [
    'Create plan takes the Top N bins (N from 1 to 30, default 5) among bins with a stored score and without a pending task.',
    'Order: higher score first; on a tie, a bin never audited first, then the older audit (as stored in the score breakdown), then the bin code.',
    "Each task keeps a copy of the score that selected it (\"score at selection\"); later recomputes do not change it. A task is PENDING until counted, then DONE.",
  ],
  counts: [
    'Only a bin with a pending task can be counted; the count closes that task. Expected quantities are the ones shown when the count was opened.',
    'PASS only if every counted quantity equals the expected one and there is no unexpected pallet; otherwise FAIL. Variance = counted - expected, in the product unit.',
    'A count never changes the inventory. No count stored for a bin means unknown, not PASS.',
  ],
  rivy: [
    'Rivy answers questions with read-only tools over synthetic demo data. It cannot create plans, count, recompute, move inventory or change rules; those actions are on the Warehouse, Tasks and Count pages.',
  ],
};

@Injectable()
export class AssistantTools {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bins: BinsService,
    private readonly scores: ScoresService,
  ) {}

  run(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (name) {
      case 'get_bin':
        return this.getBin(String(args.code ?? ''));
      case 'compare_bins':
        return this.compareBins(String(args.first ?? ''), String(args.second ?? ''));
      case 'get_top_bins':
        return this.getTopBins();
      case 'get_bin_history':
        return this.getBinHistory(String(args.code ?? ''));
      case 'get_rules':
        return Promise.resolve(this.getRules(String(args.topic ?? 'all')));
      default:
        // Includes any write the model might try: there is no such tool.
        return Promise.resolve({ error: 'UNKNOWN_TOOL', message: `There is no tool "${name}". Rivy is read-only.` });
    }
  }

  async getBin(rawCode: string): Promise<ToolResult> {
    const code = normalizeBinCode(rawCode);
    const queriedAt = new Date().toISOString();
    const bin = BIN_CODE.test(code) ? await this.bins.findByCode(code) : null;
    if (!bin) {
      return { found: false, code, queriedAt, message: `There is no bin ${code}. Codes look like A-01-03 (aisles A-C, racks 01-02, positions 01-05).` };
    }
    const pending = await this.prisma.auditTask.findFirst({ where: { bin: { code }, status: 'PENDING' }, select: { planId: true, rank: true } });
    return {
      found: true,
      code: bin.code,
      queriedAt,
      currentScore: currentScore(bin.score),
      lastAudit: bin.lastAuditedAt
        ? { date: iso(bin.lastAuditedAt), note: 'The latest count in the app; before a first count it is simulated demo data.' }
        : { date: null, note: 'Never audited.' },
      palletCount: bin.pallets.length,
      pallets: bin.pallets.map((p) => ({ code: p.code, sku: p.product.sku, product: p.product.name, quantity: p.quantity, unit: p.product.unit })),
      pendingTask: pending ? { planId: pending.planId, rank: pending.rank } : null,
      links: [{ label: `Bin ${bin.code}`, href: `/bins/${bin.code}` }, ...(pending ? [{ label: 'Tasks', href: '/tasks' }] : [])],
    };
  }

  async compareBins(rawFirst: string, rawSecond: string): Promise<ToolResult> {
    const codes = [normalizeBinCode(rawFirst), normalizeBinCode(rawSecond)];
    const queriedAt = new Date().toISOString();
    // Both bins in one read, in one snapshot: the order, the deciding rule
    // and the figures shown come from the same records, even if a recompute
    // commits meanwhile.
    const found = await this.prisma.$transaction(
      (tx) =>
        tx.bin.findMany({
          where: { code: { in: codes.filter((code) => BIN_CODE.test(code)) } },
          include: { score: true, auditTasks: { where: { status: 'PENDING' }, select: { id: true } } },
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const rows = codes.map((code) => found.find((row) => row.code === code) ?? null);
    const missing = codes.filter((_, i) => !rows[i]);
    if (missing.length > 0) {
      return { found: false, missing, queriedAt, message: `No bin ${missing.join(' or ')}.` };
    }
    const [a, b] = rows.map((row) => row!);
    const eligibility = (row: typeof a) =>
      row.auditTasks.length > 0 ? 'Not available for a new plan: it already has a pending task.' : row.score ? 'Available for a new plan.' : 'Not available for a new plan: no stored score.';
    const base = {
      found: true,
      queriedAt,
      bins: [a, b].map((row) => ({ code: row.code, currentScore: currentScore(scoreDetail(row.score)), forNewPlan: eligibility(row) })),
      links: codes.map((code) => ({ label: `Bin ${code}`, href: `/bins/${code}` })),
    };
    if (!a.score || !b.score) {
      return { ...base, higherPriority: null, decidedBy: 'A bin without a stored score cannot be ranked.' };
    }
    const candidate = (row: typeof a) => ({
      binId: row.id,
      code: row.code,
      hasPendingTask: row.auditTasks.length > 0,
      score: { value: row.score!.score, breakdown: row.score!.breakdown as never },
    });
    const [ca, cb] = [candidate(a), candidate(b)];
    const first = comparePriority(ca, cb) <= 0 ? ca : cb;
    return {
      ...base,
      higherPriority: first.code,
      decidedBy: decider(ca, cb),
      note: 'Priority uses the current stored scores; a pending task does not change priority but excludes the bin from a new plan.',
    };
  }

  // The dashboard's Top 5 (GET /scores/top), in its order (D-011).
  async getTopBins(): Promise<ToolResult> {
    const queriedAt = new Date().toISOString();
    const top = await this.scores.top();
    if (top.length === 0) {
      return { found: false, queriedAt, bins: [], message: 'No bin has a stored score yet: Recompute scores on the Warehouse page.' };
    }
    return {
      found: true,
      queriedAt,
      order: 'Highest priority first, as plans order bins: score, then never audited or older audit, then bin code. Bins with a pending task are included.',
      size: TOP_SIZE,
      bins: top.map((t) => ({ rank: t.rank, code: t.binCode, currentScore: t.score.value, band: t.score.label, scoreTime: iso(t.score.reference) })),
      links: [...top.map((t) => ({ label: `Bin ${t.binCode}`, href: `/bins/${t.binCode}` })), { label: 'Warehouse', href: '/' }],
    };
  }

  async getBinHistory(rawCode: string): Promise<ToolResult> {
    const code = normalizeBinCode(rawCode);
    const queriedAt = new Date().toISOString();
    const bin = BIN_CODE.test(code) ? await this.prisma.bin.findUnique({ where: { code }, include: { score: true } }) : null;
    if (!bin) {
      return { found: false, code, queriedAt, message: `There is no bin ${code}.` };
    }
    const tasks = await this.prisma.auditTask.findMany({
      where: { binId: bin.id },
      orderBy: { id: 'desc' },
      take: HISTORY_LIMIT,
      include: { plan: { select: { id: true, createdAt: true } } },
    });
    const items = [];
    // One query at a time (readCount runs three sequential queries).
    for (const task of tasks) {
      const count = task.status === 'DONE' ? await readCount(this.prisma, task.id) : null;
      items.push({
        planId: task.plan.id,
        planCreatedAt: iso(task.plan.createdAt),
        rank: task.rank,
        status: task.status,
        scoreAtSelection: { value: task.score, band: task.priority, scoreTime: iso(task.scoreReferenceAt), formulaVersion: task.formulaVersion },
        count: count
          ? {
              result: count.result,
              countedAt: iso(count.countedAt),
              lines: count.lines.map((l) => ({ pallet: l.palletCode, sku: l.product.sku, unit: l.product.unit, expected: l.expectedQuantity, counted: l.countedQuantity, variance: l.variance })),
              unexpectedPallets: count.unexpected.map((u) => ({ code: u.code, quantity: u.quantity, sku: u.product?.sku ?? null, unit: u.product?.unit ?? 'units declared, product unknown' })),
            }
          : null,
      });
    }
    return {
      found: true,
      code: bin.code,
      queriedAt,
      currentScore: bin.score ? { value: bin.score.score, scoreTime: iso(bin.score.referenceAt) } : null,
      taskCount: items.length,
      tasks: items,
      ...(items.length === 0 ? { note: 'No audit task or count is stored for this bin: its count history is unknown, not PASS.' } : {}),
      ...(tasks.length === HISTORY_LIMIT ? { note: `Only the latest ${HISTORY_LIMIT} tasks are listed.` } : {}),
      links: [{ label: `Bin ${bin.code}`, href: `/bins/${bin.code}` }, { label: 'Tasks', href: '/tasks' }],
    };
  }

  getRules(topic: string): ToolResult {
    const topics = topic in RULES ? [topic as keyof typeof RULES] : (Object.keys(RULES) as (keyof typeof RULES)[]);
    return { rulesVersion: RULES_VERSION, rules: Object.fromEntries(topics.map((t) => [t, RULES[t]])), links: [{ label: 'Warehouse', href: '/' }] };
  }
}

function currentScore(score: ScoreDetail | null) {
  if (!score) {
    return null;
  }
  const { factors, total } = score.breakdown;
  return {
    value: score.value,
    band: score.label,
    scoreTime: iso(score.reference),
    computedAt: iso(score.computedAt),
    formulaVersion: score.formulaVersion,
    factors: [
      { factor: 'time since last audit', weight: factors.age.weight, input: factors.age.neverAudited ? 'never audited' : `${round2(factors.age.input)} days`, cap: `${factors.age.cap} days`, points: round2(factors.age.contribution) },
      { factor: 'activity', weight: factors.activity.weight, input: `${factors.activity.input} movements in ${WINDOW_DAYS} days`, cap: factors.activity.cap, points: round2(factors.activity.contribution) },
      { factor: 'adjustments', weight: factors.adjustments.weight, input: factors.adjustments.input, cap: factors.adjustments.cap, points: round2(factors.adjustments.contribution) },
      ...(factors.lastResult
        ? [{ factor: 'last count result', weight: factors.lastResult.weight, input: factors.lastResult.result ?? 'no count (unknown, not PASS)', cap: 'FAIL', points: round2(factors.lastResult.contribution) }]
        : []),
    ],
    totalBeforeRounding: round2(total),
  };
}

type Candidate = { code: string; score: { value: number; breakdown: { factors: { age: { neverAudited: boolean; lastAuditedAt: string | null } } } } };
// Without figures: each score is given with its own bin.
function decider(a: Candidate, b: Candidate): string {
  if (a.score.value !== b.score.value) {
    return `higher score: ${a.score.value > b.score.value ? a.code : b.code}`;
  }
  const [aa, ba] = [a.score.breakdown.factors.age, b.score.breakdown.factors.age];
  const neverA = aa.neverAudited || aa.lastAuditedAt === null;
  const neverB = ba.neverAudited || ba.lastAuditedAt === null;
  if (neverA !== neverB) {
    return `same score: ${neverA ? a.code : b.code} was never audited`;
  }
  if (!neverA && aa.lastAuditedAt !== ba.lastAuditedAt) {
    const older = Date.parse(aa.lastAuditedAt!) < Date.parse(ba.lastAuditedAt!) ? a : b;
    return `same score: ${older.code} has the older audit (${older.score.breakdown.factors.age.lastAuditedAt})`;
  }
  return 'same score and audit information: bin code order';
}
