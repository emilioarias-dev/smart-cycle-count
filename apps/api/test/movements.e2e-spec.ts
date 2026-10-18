import { PrismaService } from '../src/prisma/prisma.service.js';
import { applyMovement, applyMovementInTransaction, type MovementErrorCode } from '../src/inventory/movements.js';
import { businessSnapshot, clearInventory } from './support.js';

// applyMovement against the real PostgreSQL test database (D-008).
describe('applyMovement (PostgreSQL)', () => {
  const prisma = new PrismaService();
  const at = new Date('2026-10-01T10:00:00Z');

  const pallet = (code: string) => prisma.pallet.findUniqueOrThrow({ where: { code }, include: { bin: true } });
  const version = async (code: string) => (await prisma.bin.findUniqueOrThrow({ where: { code } })).inventoryVersion;
  const putaway = (palletCode: string, quantity = 40, binCode = 'A-01-01') =>
    applyMovement(prisma, { type: 'PUTAWAY', palletCode, productSku: 'SKU-T1', binCode, quantity, occurredAt: at });
  const rejectsWith = (promise: Promise<unknown>, code: MovementErrorCode) =>
    expect(promise).rejects.toMatchObject({ name: 'MovementError', code });

  beforeEach(async () => {
    await clearInventory(prisma);
    await prisma.product.create({ data: { sku: 'SKU-T1', name: 'Test product', unit: 'case' } });
    await prisma.bin.createMany({
      data: [
        { code: 'A-01-01', aisle: 'A', rack: 1, position: 1 },
        { code: 'A-01-02', aisle: 'A', rack: 1, position: 2 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('PUTAWAY', () => {
    it('creates a located pallet, logs +q into the bin and bumps its version', async () => {
      const movement = await putaway('P-1', 40);
      expect(await pallet('P-1')).toMatchObject({ quantity: 40, bin: { code: 'A-01-01' } });
      expect(movement).toMatchObject({ type: 'PUTAWAY', fromBinId: null, quantityChange: 40 });
      expect(await version('A-01-01')).toBe(1);
      expect(await version('A-01-02')).toBe(0);
    });

    it('rejects invalid quantities, unknown bins or products and existing pallet codes', async () => {
      await rejectsWith(putaway('P-1', 0), 'INVALID_QUANTITY');
      await rejectsWith(putaway('P-1', -5), 'INVALID_QUANTITY');
      await rejectsWith(putaway('P-1', 2.5), 'INVALID_QUANTITY');
      await rejectsWith(putaway('P-1', 10, 'Z-99-99'), 'BIN_NOT_FOUND');
      await rejectsWith(
        applyMovement(prisma, { type: 'PUTAWAY', palletCode: 'P-1', productSku: 'NOPE', binCode: 'A-01-01', quantity: 5, occurredAt: at }),
        'PRODUCT_NOT_FOUND',
      );
      await putaway('P-1', 10);
      await rejectsWith(putaway('P-1', 10), 'PALLET_EXISTS');
    });

    it('never reuses a depleted pallet: a new arrival needs a new pallet code', async () => {
      await putaway('P-1', 10);
      await applyMovement(prisma, { type: 'PICK', palletCode: 'P-1', quantity: 10, occurredAt: at });
      await rejectsWith(putaway('P-1', 10), 'PALLET_EXISTS');
    });
  });

  describe('PICK', () => {
    it('removes units and logs a negative change', async () => {
      await putaway('P-1', 40);
      const movement = await applyMovement(prisma, { type: 'PICK', palletCode: 'P-1', quantity: 15, occurredAt: at });
      expect(await pallet('P-1')).toMatchObject({ quantity: 25, bin: { code: 'A-01-01' } });
      expect(movement).toMatchObject({ type: 'PICK', toBinId: null, quantityChange: -15 });
      expect(await version('A-01-01')).toBe(2);
    });

    it('depletes the pallet at zero: no bin, kept for history, no further movements', async () => {
      await putaway('P-1', 40);
      await applyMovement(prisma, { type: 'PICK', palletCode: 'P-1', quantity: 40, occurredAt: at });
      expect(await pallet('P-1')).toMatchObject({ quantity: 0, binId: null });
      expect(await version('A-01-01')).toBe(2);
      await rejectsWith(applyMovement(prisma, { type: 'PICK', palletCode: 'P-1', quantity: 1, occurredAt: at }), 'PALLET_NOT_LOCATED');
      await rejectsWith(applyMovement(prisma, { type: 'MOVE', palletCode: 'P-1', toBinCode: 'A-01-02', occurredAt: at }), 'PALLET_NOT_LOCATED');
      await rejectsWith(applyMovement(prisma, { type: 'ADJUSTMENT', palletCode: 'P-1', delta: 3, occurredAt: at }), 'PALLET_NOT_LOCATED');
    });

    it('rejects more than available, non-positive quantities and unknown pallets', async () => {
      await putaway('P-1', 40);
      await rejectsWith(applyMovement(prisma, { type: 'PICK', palletCode: 'P-1', quantity: 41, occurredAt: at }), 'INSUFFICIENT_QUANTITY');
      await rejectsWith(applyMovement(prisma, { type: 'PICK', palletCode: 'P-1', quantity: 0, occurredAt: at }), 'INVALID_QUANTITY');
      await rejectsWith(applyMovement(prisma, { type: 'PICK', palletCode: 'P-9', quantity: 1, occurredAt: at }), 'PALLET_NOT_FOUND');
    });
  });

  describe('MOVE', () => {
    it('moves the whole pallet to a different bin and bumps both versions', async () => {
      await putaway('P-1', 40);
      const movement = await applyMovement(prisma, { type: 'MOVE', palletCode: 'P-1', toBinCode: 'A-01-02', occurredAt: at });
      expect(await pallet('P-1')).toMatchObject({ quantity: 40, bin: { code: 'A-01-02' } });
      expect(movement).toMatchObject({ type: 'MOVE', quantityChange: 0 });
      expect(movement.fromBinId).not.toBe(movement.toBinId);
      expect(await version('A-01-01')).toBe(2);
      expect(await version('A-01-02')).toBe(1);
    });

    it('rejects the same bin and unknown destinations', async () => {
      await putaway('P-1', 40);
      await rejectsWith(applyMovement(prisma, { type: 'MOVE', palletCode: 'P-1', toBinCode: 'A-01-01', occurredAt: at }), 'SAME_BIN');
      await rejectsWith(applyMovement(prisma, { type: 'MOVE', palletCode: 'P-1', toBinCode: 'Z-99-99', occurredAt: at }), 'BIN_NOT_FOUND');
    });
  });

  describe('ADJUSTMENT', () => {
    it('applies a signed delta, logs from = to and bumps the bin version once', async () => {
      await putaway('P-1', 40);
      const up = await applyMovement(prisma, { type: 'ADJUSTMENT', palletCode: 'P-1', delta: 3, occurredAt: at });
      await applyMovement(prisma, { type: 'ADJUSTMENT', palletCode: 'P-1', delta: -5, occurredAt: at });
      expect(await pallet('P-1')).toMatchObject({ quantity: 38, bin: { code: 'A-01-01' } });
      expect(up.fromBinId).toBe(up.toBinId);
      expect(up.quantityChange).toBe(3);
      expect(await version('A-01-01')).toBe(3);
    });

    it('depletes at zero, and rejects a zero delta or a negative result', async () => {
      await putaway('P-1', 4);
      await rejectsWith(applyMovement(prisma, { type: 'ADJUSTMENT', palletCode: 'P-1', delta: 0, occurredAt: at }), 'INVALID_QUANTITY');
      await rejectsWith(applyMovement(prisma, { type: 'ADJUSTMENT', palletCode: 'P-1', delta: -5, occurredAt: at }), 'INSUFFICIENT_QUANTITY');
      await applyMovement(prisma, { type: 'ADJUSTMENT', palletCode: 'P-1', delta: -4, occurredAt: at });
      expect(await pallet('P-1')).toMatchObject({ quantity: 0, binId: null });
    });
  });

  describe('atomicity', () => {
    it('a rejected movement leaves quantities, locations, the log and versions unchanged', async () => {
      await putaway('P-1', 40);
      const before = await businessSnapshot(prisma);
      await rejectsWith(applyMovement(prisma, { type: 'PICK', palletCode: 'P-1', quantity: 99, occurredAt: at }), 'INSUFFICIENT_QUANTITY');
      await rejectsWith(applyMovement(prisma, { type: 'MOVE', palletCode: 'P-1', toBinCode: 'A-01-01', occurredAt: at }), 'SAME_BIN');
      expect(await businessSnapshot(prisma)).toEqual(before);
    });

    it('rolls back every write of a movement when its transaction fails afterwards', async () => {
      await putaway('P-1', 40);
      const before = await businessSnapshot(prisma);
      await expect(
        prisma.$transaction(async (tx) => {
          await applyMovementInTransaction(tx, { type: 'MOVE', palletCode: 'P-1', toBinCode: 'A-01-02', occurredAt: at });
          await applyMovementInTransaction(tx, { type: 'PICK', palletCode: 'P-1', quantity: 10, occurredAt: at });
          throw new Error('simulated failure after the writes');
        }),
      ).rejects.toThrow('simulated failure after the writes');
      expect(await businessSnapshot(prisma)).toEqual(before);
    });
  });
});
