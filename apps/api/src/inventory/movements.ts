import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

// The only way inventory changes (D-001, D-008). Inputs use business codes;
// every call runs in one transaction that locks the affected bins, validates
// the current state, updates the pallet, records the movement and bumps the
// version of each affected bin once.

export type MovementInput =
  | { type: 'PUTAWAY'; palletCode: string; productSku: string; binCode: string; quantity: number; occurredAt: Date }
  | { type: 'PICK'; palletCode: string; quantity: number; occurredAt: Date }
  | { type: 'MOVE'; palletCode: string; toBinCode: string; occurredAt: Date }
  | { type: 'ADJUSTMENT'; palletCode: string; delta: number; occurredAt: Date };

export type MovementErrorCode =
  | 'INVALID_QUANTITY'
  | 'PALLET_EXISTS'
  | 'PALLET_NOT_FOUND'
  | 'PALLET_NOT_LOCATED'
  | 'PRODUCT_NOT_FOUND'
  | 'BIN_NOT_FOUND'
  | 'SAME_BIN'
  | 'INSUFFICIENT_QUANTITY'
  | 'CONCURRENT_CHANGE';

export class MovementError extends Error {
  constructor(
    readonly code: MovementErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MovementError';
  }
}

type LockedPallet = { id: number; binId: number | null; quantity: number };

// Opens its own transaction.
export function applyMovement(prisma: PrismaClient, input: MovementInput) {
  return prisma.$transaction((tx) => applyMovementInTransaction(tx, input));
}

// Runs inside a caller's transaction (used by the demo data reset, which
// rebuilds everything in one transaction).
export async function applyMovementInTransaction(tx: Prisma.TransactionClient, input: MovementInput) {
  if (input.type === 'PUTAWAY') {
    return putaway(tx, input);
  }

  // Find where the pallet is now, lock that bin (and the destination), then
  // lock and re-read the pallet: validation always uses the locked state.
  const current = await tx.pallet.findUnique({ where: { code: input.palletCode } });
  if (!current) {
    throw new MovementError('PALLET_NOT_FOUND', `Pallet ${input.palletCode} does not exist`);
  }
  if (current.binId === null) {
    throw new MovementError('PALLET_NOT_LOCATED', `Pallet ${input.palletCode} is depleted and not in any bin`);
  }
  const toBinId = input.type === 'MOVE' ? await binIdByCode(tx, input.toBinCode) : null;
  await lockBins(tx, toBinId === null ? [current.binId] : [current.binId, toBinId]);
  const pallet = await lockPallet(tx, current.id);
  if (pallet.binId !== current.binId) {
    throw new MovementError('CONCURRENT_CHANGE', `Pallet ${input.palletCode} moved while the movement was being applied`);
  }
  const fromBinId = current.binId;

  switch (input.type) {
    case 'PICK': {
      requirePositiveInteger(input.quantity, 'Pick quantity');
      if (input.quantity > pallet.quantity) {
        throw new MovementError(
          'INSUFFICIENT_QUANTITY',
          `Cannot pick ${input.quantity} from pallet ${input.palletCode}: only ${pallet.quantity} available`,
        );
      }
      return record(tx, {
        palletId: pallet.id,
        newQuantity: pallet.quantity - input.quantity,
        newBinId: fromBinId,
        movement: { type: 'PICK', fromBinId, toBinId: null, quantityChange: -input.quantity, occurredAt: input.occurredAt },
      });
    }
    case 'MOVE': {
      if (toBinId === fromBinId) {
        throw new MovementError('SAME_BIN', `Pallet ${input.palletCode} is already in ${input.toBinCode}`);
      }
      return record(tx, {
        palletId: pallet.id,
        newQuantity: pallet.quantity,
        newBinId: toBinId,
        movement: { type: 'MOVE', fromBinId, toBinId, quantityChange: 0, occurredAt: input.occurredAt },
      });
    }
    case 'ADJUSTMENT': {
      if (!Number.isInteger(input.delta) || input.delta === 0) {
        throw new MovementError('INVALID_QUANTITY', 'Adjustment delta must be a non-zero integer');
      }
      if (pallet.quantity + input.delta < 0) {
        throw new MovementError(
          'INSUFFICIENT_QUANTITY',
          `Adjustment of ${input.delta} would leave pallet ${input.palletCode} below zero (${pallet.quantity} available)`,
        );
      }
      // From and to are the same bin by logging convention (D-008).
      return record(tx, {
        palletId: pallet.id,
        newQuantity: pallet.quantity + input.delta,
        newBinId: fromBinId,
        movement: { type: 'ADJUSTMENT', fromBinId, toBinId: fromBinId, quantityChange: input.delta, occurredAt: input.occurredAt },
      });
    }
  }
}

async function putaway(tx: Prisma.TransactionClient, input: Extract<MovementInput, { type: 'PUTAWAY' }>) {
  requirePositiveInteger(input.quantity, 'Putaway quantity');
  const binId = await binIdByCode(tx, input.binCode);
  await lockBins(tx, [binId]);
  const product = await tx.product.findUnique({ where: { sku: input.productSku } });
  if (!product) {
    throw new MovementError('PRODUCT_NOT_FOUND', `Product ${input.productSku} does not exist`);
  }
  // A depleted pallet is never reused: a putaway always creates a new pallet.
  if (await tx.pallet.findUnique({ where: { code: input.palletCode } })) {
    throw new MovementError('PALLET_EXISTS', `Pallet ${input.palletCode} already exists`);
  }
  const pallet = await tx.pallet.create({
    data: { code: input.palletCode, productId: product.id, binId, quantity: input.quantity },
  });
  const movement = await tx.movement.create({
    data: {
      type: 'PUTAWAY',
      palletId: pallet.id,
      fromBinId: null,
      toBinId: binId,
      quantityChange: input.quantity,
      occurredAt: input.occurredAt,
    },
  });
  await bumpVersions(tx, [binId]);
  return movement;
}

async function record(
  tx: Prisma.TransactionClient,
  change: {
    palletId: number;
    newQuantity: number;
    newBinId: number | null;
    movement: Omit<Prisma.MovementUncheckedCreateInput, 'palletId'>;
  },
) {
  // A pallet that reaches zero leaves its bin and is kept for history.
  await tx.pallet.update({
    where: { id: change.palletId },
    data: { quantity: change.newQuantity, binId: change.newQuantity === 0 ? null : change.newBinId },
  });
  const movement = await tx.movement.create({ data: { ...change.movement, palletId: change.palletId } });
  await bumpVersions(tx, [movement.fromBinId, movement.toBinId]);
  return movement;
}

async function binIdByCode(tx: Prisma.TransactionClient, code: string): Promise<number> {
  const bin = await tx.bin.findUnique({ where: { code }, select: { id: true } });
  if (!bin) {
    throw new MovementError('BIN_NOT_FOUND', `Bin ${code} does not exist`);
  }
  return bin.id;
}

// Locks in id order so that concurrent movements never wait on each other in
// opposite orders.
async function lockBins(tx: Prisma.TransactionClient, binIds: number[]): Promise<void> {
  const ids = [...new Set(binIds)].sort((a, b) => a - b);
  await tx.$queryRaw`SELECT id FROM bins WHERE id = ANY(${ids}::int[]) ORDER BY id FOR UPDATE`;
}

async function lockPallet(tx: Prisma.TransactionClient, palletId: number): Promise<LockedPallet> {
  const rows = await tx.$queryRaw<LockedPallet[]>`
    SELECT id, bin_id AS "binId", quantity FROM pallets WHERE id = ${palletId} FOR UPDATE`;
  return rows[0];
}

// Once per affected bin, even when a bin is both "from" and "to".
async function bumpVersions(tx: Prisma.TransactionClient, binIds: (number | null)[]): Promise<void> {
  const ids = [...new Set(binIds.filter((id): id is number => id !== null))];
  await tx.bin.updateMany({ where: { id: { in: ids } }, data: { inventoryVersion: { increment: 1 } } });
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new MovementError('INVALID_QUANTITY', `${label} must be a positive integer`);
  }
}
