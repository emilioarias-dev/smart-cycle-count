// Replaces the demo data. Run with `npm run db:reset-demo`, which compiles
// this file into dist-scripts/ and passes --confirm-reset (D-009).
// Optional: SEED_NOW (with an explicit zone) fixes the reference time;
// --scenario=high-risk loads the high-risk scenario (D-017) instead of the
// original demo (`npm run db:reset-demo-high-risk`).
import 'dotenv/config';
import { DEFAULT_SEED, GENERATOR_VERSION, SCENARIOS, SCENARIO_LABEL, type Scenario, generateDemoData } from './demo-data/generate.js';
import { resolveReference } from './demo-data/reference.js';
import { describeDatabaseUrl, resetDemoData } from './demo-data/reset.js';
import { PrismaService } from './prisma/prisma.service.js';

const confirmReset = process.argv.includes('--confirm-reset');
const scenarioArg = process.argv.find((a) => a.startsWith('--scenario='))?.slice('--scenario='.length) ?? 'standard';
console.log(`Target database: ${describeDatabaseUrl(process.env.DATABASE_URL)}`);

if (!confirmReset) {
  console.error(
    'Refused: this deletes all bins, products, pallets and movements in the target database.\n' +
      'Run `npm run db:reset-demo` (which passes --confirm-reset) to replace the demo data.',
  );
  process.exit(1);
}

if (!(SCENARIOS as readonly string[]).includes(scenarioArg)) {
  console.error(`Refused: unknown scenario "${scenarioArg}". Use one of: ${SCENARIOS.join(', ')}.`);
  process.exit(1);
}
const scenario = scenarioArg as Scenario;

let reference: Date;
try {
  reference = resolveReference(process.env.SEED_NOW);
} catch (error) {
  console.error(`Refused: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
console.log(
  `${SCENARIO_LABEL[scenario]} (${scenario}), generator v${GENERATOR_VERSION}, seed ${DEFAULT_SEED}, reference ${reference.toISOString()}` +
    (process.env.SEED_NOW ? ' (from SEED_NOW)' : ' (current time)'),
);

const prisma = new PrismaService();
try {
  const summary = await resetDemoData(prisma, generateDemoData({ reference, scenario }), { confirmReset });
  const m = summary.movements;
  console.log(
    `Demo data replaced: ${summary.bins} bins (${summary.emptyBins} empty, ${summary.neverAuditedBins} never audited), ` +
      `${summary.products} products, ${summary.pallets} pallets (${summary.depletedPallets} depleted), ` +
      `movements: ${m.PUTAWAY} putaway, ${m.PICK} pick, ${m.MOVE} move, ${m.ADJUSTMENT} adjustment ` +
      `(${summary.firstMovementAt?.toISOString()} → ${summary.lastMovementAt?.toISOString()}).`,
  );
  console.log(
    `Deleted ${summary.deleted.plans} audit plans and ${summary.deleted.tasks} tasks, with their selection explanations.`,
  );
  const counts = summary.deleted.counts;
  console.log(
    `Deleted ${counts.total} counts (${counts.pass} PASS, ${counts.fail} FAIL) with ${counts.lines} count lines and ${counts.unexpectedPallets} unexpected pallets.`,
  );
  const p = summary.scores.byPriority;
  console.log(
    `Scores computed for ${summary.scores.bins} bins at the same reference: ${p.high} high, ${p.medium} medium, ${p.low} low priority.`,
  );
} catch (error) {
  console.error(`Reset failed; the previous data was left unchanged. ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
