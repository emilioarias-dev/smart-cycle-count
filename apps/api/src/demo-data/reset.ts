import type { PrismaClient } from '../generated/prisma/client.js';
import { applyMovementInTransaction } from '../inventory/movements.js';
import { type RecomputeSummary, recomputeScoresInTransaction } from '../scoring/recompute.js';
import type { DemoData } from './generate.js';

// Replaces the demo data (D-009): bins, products, pallets and movements are
// deleted and rebuilt in ONE transaction, so a failure leaves the previous
// data untouched. Only with explicit authorisation and only on a dedicated
// project database.

export const DEDICATED_DATABASE = /^smart_cycle_count(_[a-z0-9_]+)?$/;

export class DemoResetRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoResetRefusedError';
  }
}

export type DemoSummary = {
  bins: number;
  emptyBins: number;
  neverAuditedBins: number;
  products: number;
  pallets: number;
  depletedPallets: number;
  movements: Record<'PUTAWAY' | 'PICK' | 'MOVE' | 'ADJUSTMENT', number>;
  firstMovementAt: Date | null;
  lastMovementAt: Date | null;
  scores: RecomputeSummary;
  // Plans and tasks deleted by this reset, with their selection
  // explanations (D-009).
  deleted: { plans: number; tasks: number };
};

// user@host:port/database, never the password.
export function describeDatabaseUrl(url: string | undefined): string {
  if (!url) {
    return '(DATABASE_URL is not set)';
  }
  const parsed = new URL(url);
  return `${decodeURIComponent(parsed.username)}@${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
}

export async function resetDemoData(
  prisma: PrismaClient,
  data: DemoData,
  options: { confirmReset: boolean },
): Promise<DemoSummary> {
  if (!options.confirmReset) {
    throw new DemoResetRefusedError(
      'The demo reset deletes all bins, products, pallets and movements; it needs explicit confirmation (--confirm-reset).',
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const [{ database }] = await tx.$queryRaw<{ database: string }[]>`SELECT current_database() AS database`;
      if (!DEDICATED_DATABASE.test(database)) {
        throw new DemoResetRefusedError(
          `Refusing to reset "${database}": only dedicated project databases (smart_cycle_count or smart_cycle_count_<suffix>) can be reset.`,
        );
      }

      // Every table is named and nothing cascades: if another table ever
      // references these (counts), the reset fails loudly instead of deleting
      // that data silently. Plans and tasks are deleted explicitly (D-009) and
      // reported; scores are derived data and are recomputed below.
      const deleted = { plans: await tx.auditPlan.count(), tasks: await tx.auditTask.count() };
      await tx.$executeRaw`TRUNCATE audit_tasks, audit_plans, bin_scores, movements, pallets, products, bins RESTART IDENTITY`;

      await tx.product.createMany({ data: data.products });
      await tx.bin.createMany({ data: data.bins });
      for (const movement of data.movements) {
        await applyMovementInTransaction(tx, movement);
      }
      // Scored with the reset's own reference time (D-010).
      const scores = await recomputeScoresInTransaction(tx, data.reference);

      const [bins, emptyBins, neverAuditedBins, products, pallets, depletedPallets, byType, range] = await Promise.all([
        tx.bin.count(),
        tx.bin.count({ where: { pallets: { none: {} } } }),
        tx.bin.count({ where: { lastAuditedAt: null } }),
        tx.product.count(),
        tx.pallet.count(),
        tx.pallet.count({ where: { quantity: 0 } }),
        tx.movement.groupBy({ by: ['type'], _count: { _all: true } }),
        tx.movement.aggregate({ _min: { occurredAt: true }, _max: { occurredAt: true } }),
      ]);
      const movements = { PUTAWAY: 0, PICK: 0, MOVE: 0, ADJUSTMENT: 0 };
      for (const row of byType) {
        movements[row.type] = row._count._all;
      }
      return {
        bins,
        emptyBins,
        neverAuditedBins,
        products,
        pallets,
        depletedPallets,
        movements,
        firstMovementAt: range._min.occurredAt,
        lastMovementAt: range._max.occurredAt,
        scores,
        deleted,
      };
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
}
