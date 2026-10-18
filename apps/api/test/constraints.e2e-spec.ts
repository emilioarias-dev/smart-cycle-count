import { PrismaService } from '../src/prisma/prisma.service.js';
import { clearInventory } from './support.js';

// Rules enforced by PostgreSQL itself (migration CHECKs, uniqueness and
// relations), independently of the application code (D-006 to D-008).
describe('Database constraints (PostgreSQL)', () => {
  const prisma = new PrismaService();
  const sql = (statement: string) => prisma.$executeRawUnsafe(statement);

  beforeEach(async () => {
    await clearInventory(prisma);
    await sql(`INSERT INTO products (sku, name, unit) VALUES ('SKU-T1', 'Test product', 'case')`);
    await sql(`INSERT INTO bins (code, aisle, rack, position) VALUES ('A-01-01', 'A', 1, 1), ('A-01-02', 'A', 1, 2)`);
    await sql(`INSERT INTO pallets (code, product_id, bin_id, quantity) VALUES ('P-1', 1, 1, 10)`);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('bins: the code must match the location, which must be valid and unique', async () => {
    await expect(sql(`INSERT INTO bins (code, aisle, rack, position) VALUES ('A-1-3', 'A', 1, 3)`)).rejects.toThrow(/bins_code_matches_location_check/);
    await expect(sql(`INSERT INTO bins (code, aisle, rack, position) VALUES ('a-01-03', 'a', 1, 3)`)).rejects.toThrow(/bins_aisle_check/);
    await expect(sql(`INSERT INTO bins (code, aisle, rack, position) VALUES ('A-00-03', 'A', 0, 3)`)).rejects.toThrow(/bins_rack_check/);
    await expect(sql(`INSERT INTO bins (code, aisle, rack, position) VALUES ('A-01-01', 'A', 1, 1)`)).rejects.toThrow(/Unique constraint|duplicate key/);
  });

  it('pallets: no negative quantity; positive ⇔ located', async () => {
    await expect(sql(`UPDATE pallets SET quantity = -1, bin_id = NULL WHERE code = 'P-1'`)).rejects.toThrow(/pallets_quantity_check/);
    await expect(sql(`UPDATE pallets SET bin_id = NULL WHERE code = 'P-1'`)).rejects.toThrow(/pallets_located_iff_positive_check/);
    await expect(sql(`UPDATE pallets SET quantity = 0 WHERE code = 'P-1'`)).rejects.toThrow(/pallets_located_iff_positive_check/);
    await expect(sql(`INSERT INTO pallets (code, product_id, bin_id, quantity) VALUES ('P-1', 1, 2, 5)`)).rejects.toThrow(/Unique constraint|duplicate key/);
  });

  it('movements: each type has its shape', async () => {
    const insert = (type: string, from: string, to: string, change: number) =>
      sql(`INSERT INTO movements (type, pallet_id, from_bin_id, to_bin_id, quantity_change, occurred_at)
           VALUES ('${type}', 1, ${from}, ${to}, ${change}, now())`);
    await expect(insert('PUTAWAY', 'NULL', '1', -5)).rejects.toThrow(/movements_shape_check/);
    await expect(insert('PICK', '1', '2', -5)).rejects.toThrow(/movements_shape_check/);
    await expect(insert('MOVE', '1', '1', 0)).rejects.toThrow(/movements_shape_check/);
    await expect(insert('ADJUSTMENT', '1', '2', 3)).rejects.toThrow(/movements_shape_check/);
    await expect(insert('ADJUSTMENT', '1', '1', 0)).rejects.toThrow(/movements_shape_check/);
    await expect(insert('MOVE', '1', '2', 0)).resolves.toBe(1);
  });

  it('relations: a bin or product in use cannot be deleted (no cascades)', async () => {
    await expect(sql(`DELETE FROM bins WHERE code = 'A-01-01'`)).rejects.toThrow(/foreign key|Foreign key/);
    await expect(sql(`DELETE FROM products WHERE sku = 'SKU-T1'`)).rejects.toThrow(/foreign key|Foreign key/);
  });
});
