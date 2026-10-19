import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { PRIORITY_LABEL, type ScoreBreakdown, priorityFor } from '../scoring/formula.js';
import { lockScores } from '../scoring/lock.js';
import { type PlanSelection, parsePlanSize, selectForPlan } from './selection.js';

// Creates a Top N plan and its tasks in one transaction (D-011).
//
// Plan creations take turns: a transaction-scoped advisory lock makes a
// second request wait until the first commits. The isolation level is READ
// COMMITTED on purpose, so that after waiting each request reads the bins
// that are still available. The partial unique index on audit_tasks keeps
// at most one PENDING task per bin in any case.

export const PLAN_LOCK_KEY = 4_100_011;

export type CreatedPlan = {
  plan: {
    id: number;
    requestedCount: number;
    createdCount: number;
    excluded: PlanSelection['excluded'];
    createdAt: Date;
  };
  tasks: {
    rank: number;
    binCode: string;
    score: { value: number; priority: string; label: string; reference: Date };
  }[];
};

export async function createPlan(prisma: PrismaClient, requestedSize: unknown): Promise<CreatedPlan> {
  const n = parsePlanSize(requestedSize);

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PLAN_LOCK_KEY}::bigint)`;
      // Scores and pending tasks are read while no count is changing them.
      await lockScores(tx, 'shared');

      const bins = await tx.bin.findMany({
        orderBy: { id: 'asc' },
        select: {
          id: true,
          code: true,
          score: true,
          auditTasks: { where: { status: 'PENDING' }, select: { id: true }, take: 1 },
        },
      });
      const selection = selectForPlan(
        bins.map((bin) => ({
          binId: bin.id,
          code: bin.code,
          hasPendingTask: bin.auditTasks.length > 0,
          score: bin.score ? { value: bin.score.score, breakdown: bin.score.breakdown as unknown as ScoreBreakdown } : null,
        })),
        n,
      );
      const scoreByBin = new Map(bins.map((bin) => [bin.id, bin.score!]));

      const plan = await tx.auditPlan.create({
        data: {
          requestedCount: n,
          excludedPending: selection.excluded.pendingTask,
          excludedUnscored: selection.excluded.noScore,
        },
      });
      // Each task keeps a full copy of the score that selected it (D-002).
      await tx.auditTask.createMany({
        data: selection.selected.map((candidate, index) => {
          const stored = scoreByBin.get(candidate.binId)!;
          return {
            planId: plan.id,
            binId: candidate.binId,
            rank: index + 1,
            score: stored.score,
            priority: priorityFor(stored.score),
            formulaVersion: stored.formulaVersion,
            scoreReferenceAt: stored.referenceAt,
            scoreComputedAt: stored.computedAt,
            breakdown: stored.breakdown as Prisma.InputJsonValue,
          };
        }),
      });

      return {
        plan: {
          id: plan.id,
          requestedCount: n,
          createdCount: selection.selected.length,
          excluded: selection.excluded,
          createdAt: plan.createdAt,
        },
        tasks: selection.selected.map((candidate, index) => {
          const stored = scoreByBin.get(candidate.binId)!;
          const priority = priorityFor(stored.score);
          return {
            rank: index + 1,
            binCode: candidate.code,
            score: { value: stored.score, priority, label: PRIORITY_LABEL[priority], reference: stored.referenceAt },
          };
        }),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 30_000 },
  );
}
