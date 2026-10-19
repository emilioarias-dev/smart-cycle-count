import type { Prisma } from '../generated/prisma/client.js';

// Every write of scores takes this transaction-scoped lock first: the
// recompute button, the demo reset and each count (which recomputes every bin,
// D-012). They take turns, so a recompute never overwrites scores with inputs
// read before another count committed. Plan creation takes it in shared mode
// so that it reads scores and pending tasks while no count is changing them.
//
// Taken before any row lock, so it never waits while holding one.
export const SCORES_LOCK_KEY = 4_100_012;

export async function lockScores(tx: Prisma.TransactionClient, mode: 'exclusive' | 'shared'): Promise<void> {
  if (mode === 'exclusive') {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SCORES_LOCK_KEY}::bigint)`;
  } else {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${SCORES_LOCK_KEY}::bigint)`;
  }
}
