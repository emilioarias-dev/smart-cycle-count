// Replaces the demo data. Run with `npm run db:reset-demo`, which compiles
// this file into dist-scripts/ and passes --confirm-reset (D-009).
// Optional: SEED_NOW (with an explicit zone) fixes the reference time.
import 'dotenv/config';
import { DEFAULT_SEED, GENERATOR_VERSION, generateDemoData } from './demo-data/generate.js';
import { resolveReference } from './demo-data/reference.js';
import { describeDatabaseUrl, resetDemoData } from './demo-data/reset.js';
import { PrismaService } from './prisma/prisma.service.js';

const confirmReset = process.argv.includes('--confirm-reset');
console.log(`Target database: ${describeDatabaseUrl(process.env.DATABASE_URL)}`);

if (!confirmReset) {
  console.error(
    'Refused: this deletes all bins, products, pallets and movements in the target database.\n' +
      'Run `npm run db:reset-demo` (which passes --confirm-reset) to replace the demo data.',
  );
  process.exit(1);
}

const reference = resolveReference(process.env.SEED_NOW);
console.log(
  `Generator v${GENERATOR_VERSION}, seed ${DEFAULT_SEED}, reference ${reference.toISOString()}` +
    (process.env.SEED_NOW ? ' (from SEED_NOW)' : ' (current time)'),
);

const prisma = new PrismaService();
try {
  const summary = await resetDemoData(prisma, generateDemoData({ reference }), { confirmReset });
  const m = summary.movements;
  console.log(
    `Demo data replaced: ${summary.bins} bins (${summary.emptyBins} empty, ${summary.neverAuditedBins} never audited), ` +
      `${summary.products} products, ${summary.pallets} pallets (${summary.depletedPallets} depleted), ` +
      `movements: ${m.PUTAWAY} putaway, ${m.PICK} pick, ${m.MOVE} move, ${m.ADJUSTMENT} adjustment ` +
      `(${summary.firstMovementAt?.toISOString()} → ${summary.lastMovementAt?.toISOString()}).`,
  );
} catch (error) {
  console.error(`Reset failed; the previous data was left unchanged. ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
