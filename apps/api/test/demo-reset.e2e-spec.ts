import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { ACTIVITY_DAYS, type DemoData, generateDemoData } from '../src/demo-data/generate.js';
import { resetDemoData } from '../src/demo-data/reset.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FIXED_REFERENCE, businessSnapshot } from './support.js';

// The demo reset against the real PostgreSQL test database (D-009).
describe('Demo data reset (PostgreSQL)', () => {
  const prisma = new PrismaService();
  const data = generateDemoData({ reference: FIXED_REFERENCE });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('loads the demo warehouse (fixture for generator v1, seed 20261018, reference 2026-10-18T12:00:00Z)', async () => {
    const summary = await resetDemoData(prisma, data, { confirmReset: true });
    expect(summary).toEqual({
      bins: 30,
      emptyBins: 2,
      neverAuditedBins: 11,
      products: 12,
      pallets: 110,
      depletedPallets: 27,
      movements: { PUTAWAY: 110, PICK: 257, MOVE: 63, ADJUSTMENT: 47 },
      firstMovementAt: expect.any(Date),
      lastMovementAt: expect.any(Date),
    });
    expect(summary.lastMovementAt!.getTime()).toBeLessThan(FIXED_REFERENCE.getTime());
  });

  it('running it twice leaves the same business data', async () => {
    await resetDemoData(prisma, data, { confirmReset: true });
    const first = await businessSnapshot(prisma);
    await resetDemoData(prisma, generateDemoData({ reference: FIXED_REFERENCE }), { confirmReset: true });
    expect(await businessSnapshot(prisma)).toEqual(first);
  });

  it('stores no event after the reference and keeps opening stock before the last 30 days', async () => {
    await resetDemoData(prisma, data, { confirmReset: true });
    const activityStart = new Date(FIXED_REFERENCE.getTime() - ACTIVITY_DAYS * 86_400_000);
    expect(await prisma.movement.count({ where: { occurredAt: { gte: FIXED_REFERENCE } } })).toBe(0);
    const before = await prisma.movement.groupBy({ by: ['type'], where: { occurredAt: { lt: activityStart } }, _count: { _all: true } });
    expect(before.map((row) => row.type)).toEqual(['PUTAWAY']);
    expect(await prisma.movement.count({ where: { occurredAt: { gte: activityStart } } })).toBeGreaterThan(0);
  });

  // Independent of applyMovement: replays the movement log from an empty
  // warehouse and compares with the stored inventory.
  it('the movement log rebuilds every pallet and every bin version', async () => {
    await resetDemoData(prisma, data, { confirmReset: true });
    const log = await prisma.movement.findMany({ orderBy: { id: 'asc' } });
    const pallets = new Map<number, { quantity: number; binId: number | null }>();
    const versions = new Map<number, number>();
    for (const m of log) {
      const state = pallets.get(m.palletId) ?? { quantity: 0, binId: null };
      if (m.type === 'PUTAWAY') {
        expect(pallets.has(m.palletId)).toBe(false);
        state.binId = m.toBinId;
      } else {
        expect(state.binId).toBe(m.fromBinId);
        if (m.type === 'MOVE') {
          state.binId = m.toBinId;
        }
      }
      state.quantity += m.quantityChange;
      expect(state.quantity).toBeGreaterThanOrEqual(0);
      if (state.quantity === 0) {
        state.binId = null;
      }
      pallets.set(m.palletId, state);
      for (const binId of new Set([m.fromBinId, m.toBinId])) {
        if (binId !== null) {
          versions.set(binId, (versions.get(binId) ?? 0) + 1);
        }
      }
    }

    const stored = await prisma.pallet.findMany({ select: { id: true, quantity: true, binId: true } });
    expect(stored).toHaveLength(pallets.size);
    for (const pallet of stored) {
      expect(pallets.get(pallet.id)).toEqual({ quantity: pallet.quantity, binId: pallet.binId });
    }
    for (const bin of await prisma.bin.findMany()) {
      expect(bin.inventoryVersion).toBe(versions.get(bin.id) ?? 0);
    }
  });

  it('refuses to run without explicit confirmation and changes nothing', async () => {
    await resetDemoData(prisma, data, { confirmReset: true });
    const before = await businessSnapshot(prisma);
    await expect(resetDemoData(prisma, data, { confirmReset: false })).rejects.toMatchObject({ name: 'DemoResetRefusedError' });
    expect(await businessSnapshot(prisma)).toEqual(before);
  });

  it('refuses a database that is not a dedicated project database', async () => {
    await prisma.$executeRawUnsafe('DROP DATABASE IF EXISTS scc_not_dedicated');
    await prisma.$executeRawUnsafe('CREATE DATABASE scc_not_dedicated');
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = '/scc_not_dedicated';
    const other = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
    try {
      await expect(resetDemoData(other, data, { confirmReset: true })).rejects.toThrow(/only dedicated project databases/);
    } finally {
      await other.$disconnect();
      await prisma.$executeRawUnsafe('DROP DATABASE scc_not_dedicated');
    }
  });

  it('rolls back the whole reset when the rebuild fails, keeping the previous data', async () => {
    await resetDemoData(prisma, data, { confirmReset: true });
    const before = await businessSnapshot(prisma);
    const broken: DemoData = {
      ...data,
      movements: [
        ...data.movements,
        { type: 'PICK', palletCode: 'P-0001', quantity: 100_000, occurredAt: new Date(FIXED_REFERENCE.getTime() - 1000) },
      ],
    };
    await expect(resetDemoData(prisma, broken, { confirmReset: true })).rejects.toMatchObject({ name: 'MovementError' });
    expect(await businessSnapshot(prisma)).toEqual(before);
  });
});
