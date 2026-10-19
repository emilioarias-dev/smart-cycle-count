import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import type { CountResult } from '../scoring/formula.js';
import { lockScores } from '../scoring/lock.js';
import { type ScoreSummary, scoreSummary } from '../scoring/presenter.js';
import { recomputeScoresInTransaction } from '../scoring/recompute.js';
import { type ExpectedLine, type ProductRef, expectedLines } from './sheet.js';
import { CountError, type CountSubmission, byText, canonical, deriveResult, parseSubmission } from './submission.js';

// Saves the count of one task (D-001, D-003, D-004, D-012). In ONE
// transaction: the count with its lines and unexpected pallets, the task
// marked DONE, the bin's audit date and every bin's score for the count's
// time. If anything fails, nothing is kept.
//
// Lock order: the scores lock first (counts take turns, since each one
// rewrites every score), then the bin row, the same row a movement locks.
// The version is compared only after holding the bin lock.

export type CountView = {
  id: number;
  taskId: number;
  bin: { code: string };
  result: CountResult;
  countedAt: Date;
  inventoryVersion: number;
  lines: { palletCode: string; product: ProductRef; expectedQuantity: number; countedQuantity: number; variance: number }[];
  // product null: product unknown, quantity in declared units.
  unexpected: { code: string; quantity: number; product: ProductRef | null }[];
};

export type SubmittedCount = {
  // true when this was a retry of a count already saved: nothing was repeated.
  recovered: boolean;
  count: CountView;
  // The bin's current score.
  score: ScoreSummary | null;
};

export type InventoryChange = { palletCode: string; change: 'added' | 'removed' | 'changed' };

export async function submitCount(prisma: PrismaClient, taskId: number, body: unknown): Promise<SubmittedCount> {
  const submission = parseSubmission(body);

  return prisma.$transaction(
    async (tx) => {
      await lockScores(tx, 'exclusive');
      const task = await tx.auditTask.findUnique({ where: { id: taskId }, select: { id: true, binId: true } });
      if (!task) {
        throw new CountError('TASK_NOT_FOUND', `Audit task ${taskId} not found.`);
      }
      const [bin] = await tx.$queryRaw<{ id: number; code: string; inventoryVersion: number }[]>`
        SELECT id, code, inventory_version AS "inventoryVersion" FROM bins WHERE id = ${task.binId} FOR UPDATE`;

      // A task has at most one count. The same content again is a retry and
      // gets the stored count back, even if the inventory changed since.
      const existing = await readCount(tx, taskId);
      if (existing) {
        if (canonical(asSubmission(existing)) === canonical(submission)) {
          return { recovered: true, count: existing, score: await binScore(tx, bin.id) };
        }
        throw new CountError(
          'TASK_ALREADY_COUNTED',
          `Task ${taskId} (bin ${bin.code}) was already counted: ${existing.result} at ${existing.countedAt.toISOString()}. The new quantities were not saved.`,
          { count: existing },
        );
      }

      const current = await expectedLines(tx, bin.id);
      if (bin.inventoryVersion !== submission.inventoryVersion) {
        throw new CountError(
          'INVENTORY_CHANGED',
          `The inventory of bin ${bin.code} changed after the count was opened. Nothing was saved: recount with the updated inventory.`,
          {
            inventoryVersion: bin.inventoryVersion,
            lines: current,
            changes: await changesSince(tx, bin.id, submission, current),
            unexpectedNowExpected: submission.unexpected.map((u) => u.code).filter((c) => current.some((l) => l.palletCode === c)),
          },
        );
      }

      const byCode = new Map(current.map((line) => [line.palletCode, line]));
      const submitted = new Set(submission.lines.map((l) => l.palletCode));
      if (submission.lines.length !== current.length || current.some((l) => !submitted.has(l.palletCode))) {
        throw new CountError(
          'LINES_MISMATCH',
          `Every expected pallet of bin ${bin.code} needs exactly one line (expected: ${current.map((l) => l.palletCode).join(', ') || 'none'}).`,
        );
      }
      const clash = submission.unexpected.find((u) => byCode.has(u.code));
      if (clash) {
        throw new CountError('UNEXPECTED_IS_EXPECTED', `Pallet ${clash.code} is expected in bin ${bin.code}: count it on its own line.`);
      }
      const skus = [...new Set(submission.unexpected.flatMap((u) => (u.productSku === null ? [] : [u.productSku])))];
      const products = await tx.product.findMany({ where: { sku: { in: skus } }, select: { id: true, sku: true } });
      const productIds = new Map(products.map((p) => [p.sku, p.id]));
      const missing = skus.find((sku) => !productIds.has(sku));
      if (missing) {
        throw new CountError('UNKNOWN_PRODUCT', `Product ${missing} is not in the catalog. Choose a catalog product or "product unknown".`);
      }

      const lines = submission.lines.map((l) => {
        const expectedQuantity = byCode.get(l.palletCode)!.expectedQuantity;
        return { palletCode: l.palletCode, expectedQuantity, countedQuantity: l.countedQuantity };
      });
      const result = deriveResult(lines, submission.unexpected.length);
      const countedAt = new Date();

      const count = await tx.count.create({
        data: { taskId, binId: bin.id, result, inventoryVersion: bin.inventoryVersion, countedAt },
      });
      const palletIds = new Map(
        (await tx.pallet.findMany({ where: { code: { in: lines.map((l) => l.palletCode) } }, select: { id: true, code: true } })).map((p) => [
          p.code,
          p.id,
        ]),
      );
      await tx.countLine.createMany({
        data: lines.map((l) => ({
          countId: count.id,
          palletId: palletIds.get(l.palletCode)!,
          expectedQuantity: l.expectedQuantity,
          countedQuantity: l.countedQuantity,
          variance: l.countedQuantity - l.expectedQuantity,
        })),
      });
      await tx.unexpectedPallet.createMany({
        data: submission.unexpected.map((u) => ({
          countId: count.id,
          code: u.code,
          quantity: u.quantity,
          productId: u.productSku === null ? null : productIds.get(u.productSku)!,
        })),
      });
      const done = await tx.auditTask.updateMany({ where: { id: taskId, status: 'PENDING' }, data: { status: 'DONE', completedAt: countedAt } });
      if (done.count !== 1) {
        throw new Error(`Task ${taskId} is not pending but has no count`);
      }
      // An audit, whatever its result. It does not touch the inventory or its
      // version (D-004).
      await tx.bin.update({ where: { id: bin.id }, data: { lastAuditedAt: countedAt } });

      await checkStoredResult(tx, count.id, result);
      await recomputeScoresInTransaction(tx, countedAt);

      return { recovered: false, count: (await readCount(tx, taskId))!, score: await binScore(tx, bin.id) };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 30_000 },
  );
}

export async function readCount(tx: Prisma.TransactionClient, taskId: number): Promise<CountView | null> {
  const count = await tx.count.findUnique({
    where: { taskId },
    include: {
      bin: { select: { code: true } },
      lines: { include: { pallet: { select: { code: true, product: { select: { sku: true, name: true, unit: true } } } } } },
      unexpected: { include: { product: { select: { sku: true, name: true, unit: true } } } },
    },
  });
  if (!count) {
    return null;
  }
  return {
    id: count.id,
    taskId: count.taskId,
    bin: count.bin,
    result: count.result,
    countedAt: count.countedAt,
    inventoryVersion: count.inventoryVersion,
    lines: count.lines
      .map((l) => ({
        palletCode: l.pallet.code,
        product: l.pallet.product,
        expectedQuantity: l.expectedQuantity,
        countedQuantity: l.countedQuantity,
        variance: l.variance,
      }))
      .sort((a, b) => byText(a.palletCode, b.palletCode)),
    unexpected: count.unexpected
      .map((u) => ({ code: u.code, quantity: u.quantity, product: u.product }))
      .sort((a, b) => byText(a.code, b.code)),
  };
}

function asSubmission(count: CountView): CountSubmission {
  return {
    inventoryVersion: count.inventoryVersion,
    lines: count.lines.map((l) => ({ palletCode: l.palletCode, countedQuantity: l.countedQuantity })),
    unexpected: count.unexpected.map((u) => ({ code: u.code, quantity: u.quantity, productSku: u.product?.sku ?? null })),
  };
}

// The result stored must be the one its rows give (D-012: derived and
// checked in the transaction, not by a trigger).
async function checkStoredResult(tx: Prisma.TransactionClient, countId: number, result: CountResult): Promise<void> {
  const [row] = await tx.$queryRaw<{ mismatched: number; unexpected: number }[]>`
    SELECT (SELECT count(*) FROM count_lines WHERE count_id = ${countId} AND variance <> 0)::int AS mismatched,
           (SELECT count(*) FROM count_unexpected_pallets WHERE count_id = ${countId})::int AS unexpected`;
  const derived: CountResult = row.mismatched === 0 && row.unexpected === 0 ? 'PASS' : 'FAIL';
  if (derived !== result) {
    throw new Error(`Count ${countId}: stored result ${result} does not match its lines (${derived})`);
  }
}

// Which lines differ from what the operator saw. Every movement that touches
// a bin bumps its version once (D-008), so the movements after the shown
// version are exactly the bin's movements past that position in the log.
async function changesSince(
  tx: Prisma.TransactionClient,
  binId: number,
  submission: CountSubmission,
  current: ExpectedLine[],
): Promise<InventoryChange[]> {
  const touched = new Set(
    (
      await tx.$queryRaw<{ code: string }[]>`
        SELECT DISTINCT p.code FROM (
          SELECT pallet_id FROM movements WHERE from_bin_id = ${binId} OR to_bin_id = ${binId}
          ORDER BY id OFFSET ${submission.inventoryVersion}
        ) m JOIN pallets p ON p.id = m.pallet_id`
    ).map((r) => r.code),
  );
  const shown = new Set(submission.lines.map((l) => l.palletCode));
  const now = new Set(current.map((l) => l.palletCode));
  const changes: InventoryChange[] = [
    ...current.filter((l) => !shown.has(l.palletCode)).map((l) => ({ palletCode: l.palletCode, change: 'added' as const })),
    ...submission.lines.filter((l) => !now.has(l.palletCode)).map((l) => ({ palletCode: l.palletCode, change: 'removed' as const })),
    ...current
      .filter((l) => shown.has(l.palletCode) && touched.has(l.palletCode))
      .map((l) => ({ palletCode: l.palletCode, change: 'changed' as const })),
  ];
  return changes.sort((a, b) => byText(a.palletCode, b.palletCode));
}

async function binScore(tx: Prisma.TransactionClient, binId: number): Promise<ScoreSummary | null> {
  return scoreSummary(await tx.binScore.findUnique({ where: { binId } }));
}
