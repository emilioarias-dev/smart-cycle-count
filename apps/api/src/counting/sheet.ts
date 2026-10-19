import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { normalizeBinCode } from '../inventory/bin-code.js';
import { CountError } from './submission.js';

// What the operator sees when opening a count (D-001, D-012): the bin's
// pending task, its expected pallets and the version they belong to, plus the
// product catalog for unexpected pallets.

export type ProductRef = { sku: string; name: string; unit: string };
export type ExpectedLine = { palletCode: string; product: ProductRef; expectedQuantity: number };

export type CountSheet = {
  bin: { code: string };
  task: { id: number; planId: number; rank: number };
  inventoryVersion: number;
  lines: ExpectedLine[];
  products: ProductRef[];
};

// One REPEATABLE READ snapshot: the lines and the version always describe
// the same state, even if a movement commits in between.
export function openCountSheet(prisma: PrismaClient, rawCode: string): Promise<CountSheet> {
  const code = normalizeBinCode(rawCode);
  return prisma.$transaction(
    async (tx) => {
      const bin = await tx.bin.findUnique({
        where: { code },
        select: { id: true, code: true, inventoryVersion: true, auditTasks: { where: { status: 'PENDING' } } },
      });
      if (!bin) {
        throw new CountError('BIN_NOT_FOUND', `Bin ${code} not found.`);
      }
      const [task] = bin.auditTasks;
      if (!task) {
        throw new CountError('NO_PENDING_TASK', `Bin ${bin.code} has no pending audit task, so it cannot be counted. Create a plan that includes it first.`);
      }
      const [lines, products] = await Promise.all([
        expectedLines(tx, bin.id),
        tx.product.findMany({ orderBy: { sku: 'asc' }, select: { sku: true, name: true, unit: true } }),
      ]);
      return {
        bin: { code: bin.code },
        task: { id: task.id, planId: task.planId, rank: task.rank },
        inventoryVersion: bin.inventoryVersion,
        lines,
        products,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

// The pallets currently in the bin, by code.
export async function expectedLines(tx: Prisma.TransactionClient, binId: number): Promise<ExpectedLine[]> {
  const pallets = await tx.pallet.findMany({
    where: { binId },
    orderBy: { code: 'asc' },
    select: { code: true, quantity: true, product: { select: { sku: true, name: true, unit: true } } },
  });
  return pallets.map((p) => ({ palletCode: p.code, product: p.product, expectedQuantity: p.quantity }));
}
