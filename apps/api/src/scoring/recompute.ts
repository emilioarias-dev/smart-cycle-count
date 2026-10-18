import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { type ScoreInputs, computeScore, priorityFor, scoreWindow } from './formula.js';

// Computes and stores the score of every bin for one reference time (D-010).
// Reads the inputs and replaces all scores in ONE transaction: either every
// bin gets its new score or none does, and all of them describe the same
// state of the warehouse.

export type RecomputeSummary = {
  reference: Date;
  computedAt: Date;
  bins: number;
  byPriority: { low: number; medium: number; high: number };
};

// Own transaction with a consistent snapshot (used by the recompute button).
export function recomputeScores(prisma: PrismaClient, reference: Date): Promise<RecomputeSummary> {
  return prisma.$transaction((tx) => recomputeScoresInTransaction(tx, reference), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: 10_000,
    timeout: 30_000,
  });
}

// Inside a caller's transaction (used by the demo reset).
export async function recomputeScoresInTransaction(
  tx: Prisma.TransactionClient,
  reference: Date,
): Promise<RecomputeSummary> {
  const inputs = await readInputs(tx, reference);
  const computedAt = new Date();
  const rows = inputs.map(({ binId, ...binInputs }) => {
    const breakdown = computeScore(binInputs, reference);
    return {
      binId,
      score: breakdown.score,
      formulaVersion: breakdown.formulaVersion,
      referenceAt: reference,
      computedAt,
      breakdown: breakdown as unknown as Prisma.InputJsonValue,
    };
  });

  // Only the latest score per bin is kept (D-005).
  await tx.binScore.deleteMany();
  await tx.binScore.createMany({ data: rows });

  const byPriority = { low: 0, medium: 0, high: 0 };
  for (const row of rows) {
    byPriority[priorityFor(row.score)]++;
  }
  return { reference, computedAt, bins: rows.length, byPriority };
}

// One query for all bins. A movement counts once per bin it touches: the join
// matches a bin as source or destination, so a move counts for both bins and
// an adjustment (from = to) once.
async function readInputs(tx: Prisma.TransactionClient, reference: Date) {
  const { from, to } = scoreWindow(reference);
  const rows = await tx.$queryRaw<{ binId: number; lastAuditedAt: Date | null; activity: number; adjustments: number }[]>`
    SELECT b.id AS "binId",
           b.last_audited_at AS "lastAuditedAt",
           count(m.id) FILTER (WHERE m.type IN ('PUTAWAY', 'PICK', 'MOVE'))::int AS activity,
           count(m.id) FILTER (WHERE m.type = 'ADJUSTMENT')::int AS adjustments
    FROM bins b
    LEFT JOIN movements m
      ON (m.from_bin_id = b.id OR m.to_bin_id = b.id)
     AND m.occurred_at > ${from}
     AND m.occurred_at <= ${to}
    GROUP BY b.id
    ORDER BY b.id`;
  return rows satisfies (ScoreInputs & { binId: number })[];
}
