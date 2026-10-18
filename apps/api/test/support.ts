import type { PrismaClient } from '../src/generated/prisma/client.js';

// Helpers shared by the API tests. They only ever run against the test
// database (see setup-env.ts).

export const FIXED_REFERENCE = new Date('2026-10-18T12:00:00Z');

export async function clearInventory(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`TRUNCATE bin_scores, movements, pallets, products, bins RESTART IDENTITY`;
}

// Business data only (codes, quantities, locations, dates, movement order),
// never internal ids (D-009).
export async function businessSnapshot(prisma: PrismaClient) {
  const [bins, products, pallets, movements, scores] = await Promise.all([
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
  };
}
