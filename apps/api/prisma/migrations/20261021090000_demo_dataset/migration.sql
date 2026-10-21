-- Milestone 6: the demo scenario loaded (D-017). Adds one table; existing
-- data is not changed. Until the next demo reset it has no row, and the app
-- shows the scenario as not recorded.
CREATE TABLE "demo_dataset" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "scenario" TEXT NOT NULL,
    "generator_version" INTEGER NOT NULL,
    "seed" INTEGER NOT NULL,
    "reference_at" TIMESTAMPTZ(3) NOT NULL,
    "loaded_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "demo_dataset_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "demo_dataset_single_row" CHECK ("id" = 1)
);
