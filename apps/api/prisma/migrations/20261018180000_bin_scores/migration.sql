-- Milestone 3: the latest risk score per bin (D-005, D-010).
--
-- Prisma does not run a migration inside a transaction, so this one opens its
-- own (see the milestone 2 migration).
BEGIN;

-- CreateTable
CREATE TABLE "bin_scores" (
    "bin_id" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "formula_version" INTEGER NOT NULL,
    "reference_at" TIMESTAMPTZ(3) NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL,
    "breakdown" JSONB NOT NULL,

    CONSTRAINT "bin_scores_pkey" PRIMARY KEY ("bin_id")
);

-- AddForeignKey
ALTER TABLE "bin_scores" ADD CONSTRAINT "bin_scores_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "bins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rules Prisma cannot express in the schema (D-010).
ALTER TABLE "bin_scores" ADD CONSTRAINT "bin_scores_score_check" CHECK ("score" BETWEEN 0 AND 100);
ALTER TABLE "bin_scores" ADD CONSTRAINT "bin_scores_formula_version_check" CHECK ("formula_version" >= 1);
ALTER TABLE "bin_scores" ADD CONSTRAINT "bin_scores_breakdown_check" CHECK (jsonb_typeof("breakdown") = 'object');

COMMIT;
