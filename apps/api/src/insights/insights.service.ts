import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Audit insights (D-019): what part of the warehouse was counted in the last
// 30 days and what the saved counts found. Only saved counts are used: no
// result is inferred from a bin's audit date, and no count is not a PASS.
export const INSIGHTS_DAYS = 30;
const DAY = 86_400_000;

export type CountResult = 'PASS' | 'FAIL';

// A fraction as stored; percent is null when the denominator is 0, so that
// nothing is shown as 0 % or 100 % without data.
export type Ratio = { numerator: number; denominator: number; percent: number | null };

export type ScopeInsights = {
  // null: the whole warehouse; otherwise one aisle.
  aisle: string | null;
  bins: number;
  // Distinct bins with at least one saved count in the period / bins now.
  coverage: Ratio;
  counts: { total: number; pass: number; fail: number };
  // FAIL counts / counts in the period: the counts observed, not an
  // estimate for the whole warehouse.
  failProportion: Ratio;
  // Each bin once, by its latest count in the period (counted_at, then id).
  latestResults: { pass: number; fail: number; none: number };
};

export type BinInsights = {
  code: string;
  aisle: string;
  counts: number;
  latest: { result: CountResult; countedAt: Date } | null;
};

export type AuditInsights = {
  // T, taken once on the server for this answer.
  reference: Date;
  // (start, end]: start excluded, end = reference included.
  period: { days: number; start: Date; end: Date };
  // The whole warehouse first, then each aisle in order.
  scopes: ScopeInsights[];
  // Every bin, in location order.
  bins: BinInsights[];
};

type BinRow = { code: string; aisle: string; counts: number; latest_result: CountResult | null; latest_counted_at: Date | null };
type ScopeRow = {
  aisle: string | null;
  bins: number;
  counted: number;
  counts: number;
  pass: number;
  fail: number;
  latest_pass: number;
  latest_fail: number;
  latest_none: number;
  coverage_percent: number | null;
  fail_percent: number | null;
};

@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  // Read only, on one snapshot: both queries see the same counts and bins.
  // The reference can be given by tests; the API always uses the server time.
  audits(reference: Date = new Date()): Promise<AuditInsights> {
    const start = new Date(reference.getTime() - INSIGHTS_DAYS * DAY);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        // Counts are joined without their lines or unexpected pallets, so a
        // count is one row however many lines it has.
        const perBin = Prisma.sql`
          WITH period AS (
            SELECT id, bin_id, result::text AS result, counted_at FROM counts
            WHERE counted_at > ${start}::timestamptz AND counted_at <= ${reference}::timestamptz),
          latest AS (
            SELECT DISTINCT ON (bin_id) bin_id, result, counted_at FROM period
            ORDER BY bin_id, counted_at DESC, id DESC),
          per_bin AS (
            SELECT b.code, b.aisle, b.rack, b.position,
                   (SELECT count(*) FROM period p WHERE p.bin_id = b.id)::int AS counts,
                   (SELECT count(*) FROM period p WHERE p.bin_id = b.id AND p.result = 'PASS')::int AS pass,
                   (SELECT count(*) FROM period p WHERE p.bin_id = b.id AND p.result = 'FAIL')::int AS fail,
                   l.result AS latest_result, l.counted_at AS latest_counted_at
            FROM bins b LEFT JOIN latest l ON l.bin_id = b.id)`;
        const bins = await tx.$queryRaw<BinRow[]>`
          ${perBin}
          SELECT code, aisle, counts, latest_result, latest_counted_at FROM per_bin
          ORDER BY aisle, rack, position`;
        const scopes = await tx.$queryRaw<ScopeRow[]>`
          ${perBin},
          totals AS (
            SELECT aisle, GROUPING(aisle) AS whole,
                   count(*)::int AS bins,
                   count(*) FILTER (WHERE counts > 0)::int AS counted,
                   coalesce(sum(counts), 0)::int AS counts,
                   coalesce(sum(pass), 0)::int AS pass,
                   coalesce(sum(fail), 0)::int AS fail,
                   count(*) FILTER (WHERE latest_result = 'PASS')::int AS latest_pass,
                   count(*) FILTER (WHERE latest_result = 'FAIL')::int AS latest_fail,
                   count(*) FILTER (WHERE latest_result IS NULL)::int AS latest_none
            FROM per_bin GROUP BY GROUPING SETS ((), (aisle)))
          SELECT CASE WHEN whole = 1 THEN NULL ELSE aisle END AS aisle, bins, counted, counts, pass, fail,
                 latest_pass, latest_fail, latest_none,
                 round(100.0 * counted / nullif(bins, 0), 1)::float8 AS coverage_percent,
                 round(100.0 * fail / nullif(counts, 0), 1)::float8 AS fail_percent
          FROM totals ORDER BY whole DESC, aisle`;
        return {
          reference,
          period: { days: INSIGHTS_DAYS, start, end: reference },
          scopes: scopes.map((s) => ({
            aisle: s.aisle,
            bins: s.bins,
            coverage: { numerator: s.counted, denominator: s.bins, percent: s.coverage_percent },
            counts: { total: s.counts, pass: s.pass, fail: s.fail },
            failProportion: { numerator: s.fail, denominator: s.counts, percent: s.fail_percent },
            latestResults: { pass: s.latest_pass, fail: s.latest_fail, none: s.latest_none },
          })),
          bins: bins.map((b) => ({
            code: b.code,
            aisle: b.aisle,
            counts: b.counts,
            latest: b.latest_result && b.latest_counted_at ? { result: b.latest_result, countedAt: b.latest_counted_at } : null,
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
