-- Milestone 2: warehouse layout, products, pallets and the movement log
-- (D-006 to D-009).
--
-- Prisma does not run a migration inside a transaction, so this one opens its
-- own: if any statement fails, nothing (including the sample bin deletion)
-- is applied.
BEGIN;

-- The milestone 1 sample bin does not fit the new code format and is removed
-- explicitly. Any other existing bin stops the migration instead of being
-- deleted: such data needs a deliberate decision.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "bins" WHERE "code" <> 'SAMPLE-BIN-01') THEN
    RAISE EXCEPTION 'bins contains rows other than the milestone 1 sample bin (SAMPLE-BIN-01); refusing to migrate them automatically';
  END IF;
END $$;

DELETE FROM "bins" WHERE "code" = 'SAMPLE-BIN-01';

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('PUTAWAY', 'PICK', 'MOVE', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "bins" ADD COLUMN     "aisle" TEXT NOT NULL,
ADD COLUMN     "inventory_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_audited_at" TIMESTAMPTZ(3),
ADD COLUMN     "position" INTEGER NOT NULL,
ADD COLUMN     "rack" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pallets" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "product_id" INTEGER NOT NULL,
    "bin_id" INTEGER,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "pallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movements" (
    "id" SERIAL NOT NULL,
    "type" "MovementType" NOT NULL,
    "pallet_id" INTEGER NOT NULL,
    "from_bin_id" INTEGER,
    "to_bin_id" INTEGER,
    "quantity_change" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "pallets_code_key" ON "pallets"("code");

-- CreateIndex
CREATE INDEX "pallets_bin_id_idx" ON "pallets"("bin_id");

-- CreateIndex
CREATE INDEX "movements_pallet_id_idx" ON "movements"("pallet_id");

-- CreateIndex
CREATE INDEX "movements_from_bin_id_idx" ON "movements"("from_bin_id");

-- CreateIndex
CREATE INDEX "movements_to_bin_id_idx" ON "movements"("to_bin_id");

-- CreateIndex
CREATE INDEX "movements_occurred_at_idx" ON "movements"("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "bins_aisle_rack_position_key" ON "bins"("aisle", "rack", "position");

-- AddForeignKey
ALTER TABLE "pallets" ADD CONSTRAINT "pallets_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pallets" ADD CONSTRAINT "pallets_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "bins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movements" ADD CONSTRAINT "movements_pallet_id_fkey" FOREIGN KEY ("pallet_id") REFERENCES "pallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movements" ADD CONSTRAINT "movements_from_bin_id_fkey" FOREIGN KEY ("from_bin_id") REFERENCES "bins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movements" ADD CONSTRAINT "movements_to_bin_id_fkey" FOREIGN KEY ("to_bin_id") REFERENCES "bins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rules Prisma cannot express in the schema.

-- D-006: location ranges, and the code derived from the location (A-01-03).
ALTER TABLE "bins" ADD CONSTRAINT "bins_aisle_check" CHECK ("aisle" ~ '^[A-Z]$');
ALTER TABLE "bins" ADD CONSTRAINT "bins_rack_check" CHECK ("rack" BETWEEN 1 AND 99);
ALTER TABLE "bins" ADD CONSTRAINT "bins_position_check" CHECK ("position" BETWEEN 1 AND 99);
ALTER TABLE "bins" ADD CONSTRAINT "bins_code_matches_location_check" CHECK (
  "code" = "aisle" || '-' || lpad("rack"::text, 2, '0') || '-' || lpad("position"::text, 2, '0')
);
ALTER TABLE "bins" ADD CONSTRAINT "bins_inventory_version_check" CHECK ("inventory_version" >= 0);

-- D-007: one unit per product; quantities never negative; a pallet with a
-- positive quantity is located and a depleted pallet is not.
ALTER TABLE "products" ADD CONSTRAINT "products_unit_check" CHECK (length(trim("unit")) > 0);
ALTER TABLE "pallets" ADD CONSTRAINT "pallets_quantity_check" CHECK ("quantity" >= 0);
ALTER TABLE "pallets" ADD CONSTRAINT "pallets_located_iff_positive_check" CHECK (("quantity" > 0) = ("bin_id" IS NOT NULL));

-- D-008: the shape of each movement type.
ALTER TABLE "movements" ADD CONSTRAINT "movements_shape_check" CHECK (
  ("type" = 'PUTAWAY'    AND "from_bin_id" IS NULL     AND "to_bin_id" IS NOT NULL AND "quantity_change" > 0)
  OR ("type" = 'PICK'       AND "from_bin_id" IS NOT NULL AND "to_bin_id" IS NULL     AND "quantity_change" < 0)
  OR ("type" = 'MOVE'       AND "from_bin_id" IS NOT NULL AND "to_bin_id" IS NOT NULL AND "from_bin_id" <> "to_bin_id" AND "quantity_change" = 0)
  OR ("type" = 'ADJUSTMENT' AND "from_bin_id" IS NOT NULL AND "from_bin_id" = "to_bin_id" AND "quantity_change" <> 0)
);

COMMIT;
