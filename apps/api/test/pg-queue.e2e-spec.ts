import { createRequire } from 'node:module';
import { openCountSheet } from '../src/counting/sheet.js';
import { submitCount } from '../src/counting/submit.js';
import { applyMovement } from '../src/inventory/movements.js';
import { createPlan } from '../src/planning/create-plan.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { recomputeScores } from '../src/scoring/recompute.js';
import { clearInventory } from './support.js';

// pg 8 warns "Calling client.query() when the client is already executing a
// query is deprecated" (it will fail in pg 9) when a query is added while
// another one is still waiting in the client's queue (lib/client.js). The
// warning is printed once per process, so a test listening for it could be
// silenced by an earlier test. Instead, this test checks that condition on
// every query, through the pg used by the Prisma adapter.
const requireFromAdapter = createRequire(createRequire(import.meta.url).resolve('@prisma/adapter-pg'));
const { Client } = requireFromAdapter('pg') as { Client: { prototype: { query: (...args: unknown[]) => unknown } } };

type QueueState = { _queryQueue?: unknown[]; pipeline?: boolean };

function watchQueuedQueries() {
  const original = Client.prototype.query;
  const queued: string[] = [];
  Client.prototype.query = function (this: QueueState, config: unknown, ...rest: unknown[]) {
    if (!Array.isArray(this._queryQueue)) {
      throw new Error('pg no longer has _queryQueue: update this test to the installed pg version');
    }
    if (this._queryQueue.length > 0 && !this.pipeline) {
      const text = typeof config === 'string' ? config : ((config as { text?: string })?.text ?? '?');
      queued.push(text.replace(/\s+/g, ' ').slice(0, 120));
    }
    return original.call(this, config, ...rest);
  };
  return { queued, restore: () => (Client.prototype.query = original) };
}

describe('Queries on a transaction client (PostgreSQL)', () => {
  const prisma = new PrismaService();
  const R = new Date('2026-10-18T12:00:00Z');

  beforeEach(async () => {
    await clearInventory(prisma);
    await prisma.product.create({ data: { sku: 'SKU-A', name: 'Bottled water', unit: 'case' } });
    await prisma.bin.create({ data: { code: 'A-01-01', aisle: 'A', rack: 1, position: 1 } });
    for (const palletCode of ['P-1', 'P-2']) {
      await applyMovement(prisma, { type: 'PUTAWAY', palletCode, productSku: 'SKU-A', binCode: 'A-01-01', quantity: 5, occurredAt: R });
    }
    await recomputeScores(prisma, R);
    await createPlan(prisma, 1);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // The watcher itself: a findUnique loading three relations inside a
  // transaction queues a query (the pattern found in the diagnosis). It makes
  // pg warn on purpose, so it is skipped when deprecations are thrown
  // (NODE_OPTIONS=--throw-deprecation, the strict whole-suite check).
  const throwsDeprecations = process.throwDeprecation === true;
  it.skipIf(throwsDeprecations)('the watcher detects a query queued behind another one', async () => {
    const watch = watchQueuedQueries();
    try {
      await prisma.$transaction((tx) =>
        tx.bin.findUnique({ where: { code: 'A-01-01' }, include: { pallets: true, auditTasks: true, score: true } }),
      );
    } finally {
      watch.restore();
    }
    expect(watch.queued.length).toBeGreaterThan(0);
  });

  it('opening, saving and recovering a count never queue a query on the transaction client', async () => {
    const watch = watchQueuedQueries();
    const body = {
      inventoryVersion: 2,
      lines: [
        { palletCode: 'P-1', countedQuantity: 5 },
        { palletCode: 'P-2', countedQuantity: 4 },
      ],
      unexpected: [{ code: 'X-1', quantity: 3, productSku: 'SKU-A' }],
    };
    try {
      const sheet = await openCountSheet(prisma, 'A-01-01');
      const saved = await submitCount(prisma, sheet.task.id, body);
      const recovered = await submitCount(prisma, sheet.task.id, body);
      expect([saved.recovered, recovered.recovered]).toEqual([false, true]);
      expect(recovered.count).toEqual(saved.count);
    } finally {
      watch.restore();
    }
    expect(watch.queued).toEqual([]);
  });
});
