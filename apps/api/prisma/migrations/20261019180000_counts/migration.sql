-- Milestone 5: counts, their lines and unexpected pallets (D-001, D-003,
-- D-004, D-012).
--
-- Prisma does not run a migration inside a transaction, so this one opens its
-- own (see the milestone 2 migration).
BEGIN;
-- CreateEnum
CREATE TYPE "CountResult" AS ENUM ('PASS', 'FAIL');

-- CreateTable
CREATE TABLE "counts" (
    "id" SERIAL NOT NULL,
    "task_id" INTEGER NOT NULL,
    "bin_id" INTEGER NOT NULL,
    "result" "CountResult" NOT NULL,
    "inventory_version" INTEGER NOT NULL,
    "counted_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "count_lines" (
    "id" SERIAL NOT NULL,
    "count_id" INTEGER NOT NULL,
    "pallet_id" INTEGER NOT NULL,
    "expected_quantity" INTEGER NOT NULL,
    "counted_quantity" INTEGER NOT NULL,
    "variance" INTEGER NOT NULL,

    CONSTRAINT "count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "count_unexpected_pallets" (
    "id" SERIAL NOT NULL,
    "count_id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "product_id" INTEGER,

    CONSTRAINT "count_unexpected_pallets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "counts_task_id_key" ON "counts"("task_id");

-- CreateIndex
CREATE INDEX "counts_bin_id_counted_at_idx" ON "counts"("bin_id", "counted_at");

-- CreateIndex
CREATE UNIQUE INDEX "counts_task_id_bin_id_key" ON "counts"("task_id", "bin_id");

-- CreateIndex
CREATE INDEX "count_lines_pallet_id_idx" ON "count_lines"("pallet_id");

-- CreateIndex
CREATE UNIQUE INDEX "count_lines_count_id_pallet_id_key" ON "count_lines"("count_id", "pallet_id");

-- CreateIndex
CREATE INDEX "count_unexpected_pallets_product_id_idx" ON "count_unexpected_pallets"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "count_unexpected_pallets_count_id_code_key" ON "count_unexpected_pallets"("count_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "audit_tasks_id_bin_id_key" ON "audit_tasks"("id", "bin_id");

-- AddForeignKey
ALTER TABLE "counts" ADD CONSTRAINT "counts_task_id_bin_id_fkey" FOREIGN KEY ("task_id", "bin_id") REFERENCES "audit_tasks"("id", "bin_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counts" ADD CONSTRAINT "counts_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "bins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_lines" ADD CONSTRAINT "count_lines_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_lines" ADD CONSTRAINT "count_lines_pallet_id_fkey" FOREIGN KEY ("pallet_id") REFERENCES "pallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_unexpected_pallets" ADD CONSTRAINT "count_unexpected_pallets_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_unexpected_pallets" ADD CONSTRAINT "count_unexpected_pallets_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules Prisma cannot express in the schema. Each CHECK protects one row;
-- PASS/FAIL depends on several rows and is derived and checked inside the
-- count's transaction instead (D-012).

ALTER TABLE "counts" ADD CONSTRAINT "counts_inventory_version_check" CHECK ("inventory_version" >= 0);

-- An expected pallet is in the bin, so its quantity is positive (D-007).
ALTER TABLE "count_lines" ADD CONSTRAINT "count_lines_quantities_check" CHECK ("expected_quantity" > 0 AND "counted_quantity" >= 0);
ALTER TABLE "count_lines" ADD CONSTRAINT "count_lines_variance_check" CHECK ("variance" = "counted_quantity" - "expected_quantity");

-- Codes are stored normalised: upper case, no whitespace, 1 to 40 characters.
ALTER TABLE "count_unexpected_pallets" ADD CONSTRAINT "count_unexpected_pallets_code_check" CHECK ("code" = upper("code") AND "code" !~ '\s' AND char_length("code") BETWEEN 1 AND 40);
ALTER TABLE "count_unexpected_pallets" ADD CONSTRAINT "count_unexpected_pallets_quantity_check" CHECK ("quantity" >= 1);

COMMIT;
