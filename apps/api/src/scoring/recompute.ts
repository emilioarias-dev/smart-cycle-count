import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { type CountResult, type ScoreInputs, computeScore, priorityFor, scoreWindow } from './formula.js';
import { lockScores } from './lock.js';

// Computes and stores the score of every bin for one reference time (D-010).
// Reads the inputs and replaces all scores in ONE transaction: either every
// bin gets its new score or none does. The inputs are read by ONE statement,
// so they describe a single state of the warehouse.

export type RecomputeSummary = {
  reference: Date;
  computedAt: Date;
  bins: number;
  byPriority: { low: number; medium: number; high: number };
};

// Own transaction (used by the recompute button). READ COMMITTED on purpose:
// after waiting for the scores lock, the inputs include what the previous
// holder committed.
export function recomputeScores(prisma: PrismaClient, reference: Date): Promise<RecomputeSummary> {
  return prisma.$transaction(
    async (tx) => {
      await lockScores(tx, 'exclusive');
      return recomputeScoresInTransaction(tx, reference);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 30_000 },
  );
}

// Inside a caller's transaction, which must hold the scores lock (the demo
// reset and the count).
export async function recomputeScoresInTransaction(
  tx: Prisma.TransactionClient,
  reference: Date,
): Promise<RecomputeSummary> {
  const inputs = await readInputs(tx, reference);
  const computedAt = new Date();
  const rows = inputs.map(({ binId, lastAuditedAt, activity, adjustments, lastResult, lastCountedAt }) => {
    const lastCount = lastResult === null || lastCountedAt === null ? null : { result: lastResult, countedAt: lastCountedAt };
    const breakdown = computeScore({ lastAuditedAt, activity, adjustments, lastCount }, reference);
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

type InputRow = Omit<ScoreInputs, 'lastCount'> & {
  binId: number;
  lastResult: CountResult | null;
  lastCountedAt: Date | null;
};

// One query for all bins. A movement counts once per bin it touches: the join
// matches a bin as source or destination, so a move counts for both bins and
// an adjustment (from = to) once. The last result is the latest count up to
// the reference (the highest id breaks a tie in time).
async function readInputs(tx: Prisma.TransactionClient, reference: Date): Promise<InputRow[]> {
  const { from, to } = scoreWindow(reference);
  return tx.$queryRaw<InputRow[]>`
    SELECT b.id AS "binId",
           b.last_audited_at AS "lastAuditedAt",
           (SELECT count(*) FROM movements m
             WHERE (m.from_bin_id = b.id OR m.to_bin_id = b.id)
               AND m.type IN ('PUTAWAY', 'PICK', 'MOVE')
               AND m.occurred_at > ${from} AND m.occurred_at <= ${to})::int AS activity,
           (SELECT count(*) FROM movements m
             WHERE (m.from_bin_id = b.id OR m.to_bin_id = b.id)
               AND m.type = 'ADJUSTMENT'
               AND m.occurred_at > ${from} AND m.occurred_at <= ${to})::int AS adjustments,
           lc.result::text AS "lastResult",
           lc.counted_at AS "lastCountedAt"
    FROM bins b
    LEFT JOIN LATERAL (
      SELECT c.result, c.counted_at FROM counts c
       WHERE c.bin_id = b.id AND c.counted_at <= ${to}
       ORDER BY c.counted_at DESC, c.id DESC
       LIMIT 1
    ) lc ON true
    ORDER BY b.id`;
}
