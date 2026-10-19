-- Milestone 4: Top N audit plans and their tasks (D-011, D-002).
--
-- Prisma does not run a migration inside a transaction, so this one opens its
-- own (see the milestone 2 migration).
BEGIN;

-- CreateEnum
CREATE TYPE "AuditTaskStatus" AS ENUM ('PENDING', 'DONE');

-- CreateTable
CREATE TABLE "audit_plans" (
    "id" SERIAL NOT NULL,
    "requested_count" INTEGER NOT NULL,
    "excluded_pending" INTEGER NOT NULL,
    "excluded_unscored" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_tasks" (
    "id" SERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "bin_id" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "status" "AuditTaskStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "score" INTEGER NOT NULL,
    "priority" TEXT NOT NULL,
    "formula_version" INTEGER NOT NULL,
    "score_reference_at" TIMESTAMPTZ(3) NOT NULL,
    "score_computed_at" TIMESTAMPTZ(3) NOT NULL,
    "breakdown" JSONB NOT NULL,

    CONSTRAINT "audit_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_tasks_bin_id_idx" ON "audit_tasks"("bin_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_tasks_plan_id_rank_key" ON "audit_tasks"("plan_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "audit_tasks_plan_id_bin_id_key" ON "audit_tasks"("plan_id", "bin_id");

-- AddForeignKey
ALTER TABLE "audit_tasks" ADD CONSTRAINT "audit_tasks_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "audit_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_tasks" ADD CONSTRAINT "audit_tasks_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "bins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules Prisma cannot express in the schema (D-011).

-- N between 1 and 30; exclusion counts never negative.
ALTER TABLE "audit_plans" ADD CONSTRAINT "audit_plans_requested_count_check" CHECK ("requested_count" BETWEEN 1 AND 30);
ALTER TABLE "audit_plans" ADD CONSTRAINT "audit_plans_excluded_check" CHECK ("excluded_pending" >= 0 AND "excluded_unscored" >= 0);

-- The copied score (D-002) is a valid score with its band.
ALTER TABLE "audit_tasks" ADD CONSTRAINT "audit_tasks_rank_check" CHECK ("rank" BETWEEN 1 AND 30);
ALTER TABLE "audit_tasks" ADD CONSTRAINT "audit_tasks_score_check" CHECK ("score" BETWEEN 0 AND 100);
ALTER TABLE "audit_tasks" ADD CONSTRAINT "audit_tasks_priority_check" CHECK ("priority" IN ('low', 'medium', 'high'));
ALTER TABLE "audit_tasks" ADD CONSTRAINT "audit_tasks_breakdown_check" CHECK (jsonb_typeof("breakdown") = 'object');

-- A task is completed if and only if it is DONE (DONE comes with counts).
ALTER TABLE "audit_tasks" ADD CONSTRAINT "audit_tasks_completed_check" CHECK (("status" = 'DONE') = ("completed_at" IS NOT NULL));

-- At most one PENDING task per bin, whatever the plan.
CREATE UNIQUE INDEX "audit_tasks_one_pending_per_bin" ON "audit_tasks"("bin_id") WHERE "status" = 'PENDING';

COMMIT;
