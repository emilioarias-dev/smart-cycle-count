import type { PrismaClient } from '../src/generated/prisma/client.js';

// Helpers shared by the API tests. They only ever run against the test
// database (see setup-env.ts).

export const FIXED_REFERENCE = new Date('2026-10-18T12:00:00Z');

export async function clearInventory(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`TRUNCATE count_unexpected_pallets, count_lines, counts, audit_tasks, audit_plans, bin_scores, movements, pallets, products, bins RESTART IDENTITY`;
}

// The D-010 formula, version 2 (D-012), written directly in SQL: independent
// of the scoring code. The last result is the latest count up to the
// reference; a FAIL adds 25, a PASS or no count adds nothing.
export function scoresInSql(prisma: PrismaClient, reference: Date) {
  return prisma.$queryRaw<{ code: string; score: number }[]>`
    WITH touch AS (
      SELECT m.id, m.type, b.bin_id
      FROM movements m,
           LATERAL (SELECT DISTINCT x FROM unnest(ARRAY[m.from_bin_id, m.to_bin_id]) x WHERE x IS NOT NULL) b(bin_id)
      WHERE m.occurred_at > ${reference}::timestamptz - interval '30 days' AND m.occurred_at <= ${reference}::timestamptz),
    last_result AS (
      SELECT DISTINCT ON (bin_id) bin_id, result
      FROM counts WHERE counted_at <= ${reference}::timestamptz
      ORDER BY bin_id, counted_at DESC, id DESC),
    f AS (
      SELECT b.code,
             CASE WHEN b.last_audited_at IS NULL THEN 1
                  ELSE least(greatest(extract(epoch FROM (${reference}::timestamptz - b.last_audited_at)), 0) / 86400.0 / 90, 1) END AS f_age,
             least(count(t.id) FILTER (WHERE t.type IN ('PUTAWAY', 'PICK', 'MOVE')) / 40.0, 1) AS f_act,
             least(count(t.id) FILTER (WHERE t.type = 'ADJUSTMENT') / 5.0, 1) AS f_adj,
             CASE WHEN max(lr.result::text) = 'FAIL' THEN 1 ELSE 0 END AS f_fail
      FROM bins b LEFT JOIN touch t ON t.bin_id = b.id LEFT JOIN last_result lr ON lr.bin_id = b.id
      GROUP BY b.id, b.code, b.last_audited_at)
    SELECT code, round(30 * f_age + 25 * f_act + 20 * f_adj + 25 * f_fail)::int AS score FROM f ORDER BY code`;
}

// Business data only (codes, quantities, locations, dates, movement order),
// never internal ids (D-009).
export async function businessSnapshot(prisma: PrismaClient) {
  const [bins, products, pallets, movements, scores, plans, counts] = await Promise.all([
    prisma.bin.findMany({
      orderBy: [{ aisle: 'asc' }, { rack: 'asc' }, { position: 'asc' }],
      select: { code: true, aisle: true, rack: true, position: true, inventoryVersion: true, lastAuditedAt: true },
    }),
    prisma.product.findMany({ orderBy: { sku: 'asc' }, select: { sku: true, name: true, unit: true } }),
    prisma.pallet.findMany({
      orderBy: { code: 'asc' },
      select: { code: true, quantity: true, product: { select: { sku: true } }, bin: { select: { code: true } } },
    }),
    prisma.movement.findMany({
      orderBy: { id: 'asc' },
      select: {
        type: true,
        quantityChange: true,
        occurredAt: true,
        pallet: { select: { code: true } },
        fromBin: { select: { code: true } },
        toBin: { select: { code: true } },
      },
    }),
    // computedAt is the wall-clock time of the computation, not business data.
    prisma.binScore.findMany({
      orderBy: { bin: { code: 'asc' } },
      select: { score: true, formulaVersion: true, referenceAt: true, breakdown: true, bin: { select: { code: true } } },
    }),
    // Creation times are wall-clock times, not business data.
    prisma.auditPlan.findMany({
      orderBy: { id: 'asc' },
      select: {
        requestedCount: true,
        excludedPending: true,
        excludedUnscored: true,
        tasks: {
          orderBy: { rank: 'asc' },
          select: {
            rank: true,
            status: true,
            score: true,
            priority: true,
            formulaVersion: true,
            scoreReferenceAt: true,
            scoreComputedAt: true,
            breakdown: true,
            bin: { select: { code: true } },
          },
        },
      },
    }),
    prisma.count.findMany({
      orderBy: { id: 'asc' },
      select: {
        result: true,
        inventoryVersion: true,
        countedAt: true,
        bin: { select: { code: true } },
        lines: { orderBy: { pallet: { code: 'asc' } }, select: { expectedQuantity: true, countedQuantity: true, variance: true, pallet: { select: { code: true } } } },
        unexpected: { orderBy: { code: 'asc' }, select: { code: true, quantity: true, product: { select: { sku: true } } } },
      },
    }),
  ]);
  return {
    bins,
    products,
    pallets: pallets.map((p) => ({ code: p.code, sku: p.product.sku, bin: p.bin?.code ?? null, quantity: p.quantity })),
    movements: movements.map((m) => ({
      type: m.type,
      pallet: m.pallet.code,
      from: m.fromBin?.code ?? null,
      to: m.toBin?.code ?? null,
      change: m.quantityChange,
      occurredAt: m.occurredAt.toISOString(),
    })),
    scores: scores.map((s) => ({
      bin: s.bin.code,
      score: s.score,
      formulaVersion: s.formulaVersion,
      reference: s.referenceAt.toISOString(),
      breakdown: s.breakdown,
    })),
    plans,
    counts,
  };
}
