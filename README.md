# Smart Cycle Count Scoring

A small app that helps warehouse teams decide which bins to audit first: each
bin gets a 0–100 risk score with an explanation, shown on a color-coded
heatmap, and audits feed back into the score.

Stack: Next.js (web) + NestJS (API) + Prisma + PostgreSQL, in an npm
workspaces monorepo.

## Status

- **Milestone 1 (walking skeleton):** PostgreSQL → Prisma → NestJS → Next.js.
- **Milestone 2 (warehouse data):** a demo warehouse of 30 bins with
  products, pallets and a month of simulated activity, all changes made by a
  single movement function; a warehouse grid and a bin detail page.
- **Milestone 3 (risk scoring):** a 0–100 audit priority per bin with its
  breakdown, a color-coded grid and a recompute button.
- **Milestone 4 (audit plans):** "Create plan → Top N" from the warehouse
  page and a tasks page; each task keeps the score that selected it.
- **Milestone 5 (count flow):** a phone-friendly count page: find a bin with
  a pending task, count its pallets, record unexpected pallets, get
  PASS/FAIL; the task is closed and every score is recomputed with the
  result.

See [`PROGRESS.md`](PROGRESS.md).

## Requirements

- Node.js **24.22.0** and npm **11.19.1** (the npm bundled with that Node
  release). Any later 24.x works; other major versions are rejected by
  `npm ci` (`engine-strict`).
- Docker with Docker Compose (for PostgreSQL 16.15).
- Free local ports: `5433` (PostgreSQL container), `3001` (API), `3000`
  (web). The container uses host port 5433 so it does not collide with a
  PostgreSQL already installed on the machine (usually on 5432), which is
  left untouched.

## Getting started

Run every command from the repository root. Commands are the same in bash and
PowerShell except where two variants are shown.

1. Install the exact dependency tree from the lockfile:

   ```
   npm ci
   ```

2. Create the local environment files from the templates (local development
   values only, no secrets):

   ```bash
   # bash
   cp apps/api/.env.example apps/api/.env
   cp apps/web/.env.example apps/web/.env
   ```

   ```powershell
   # PowerShell
   Copy-Item apps/api/.env.example apps/api/.env
   Copy-Item apps/web/.env.example apps/web/.env
   ```

3. Start PostgreSQL and wait until it is healthy:

   ```
   npm run db:up
   ```

   `docker compose ps` should show the `db` service as `healthy` with
   `127.0.0.1:5433->5432/tcp`.

4. Generate the Prisma client, apply the migrations and load the demo data:

   ```
   npm run db:generate
   npm run db:migrate
   npm run db:reset-demo
   ```

   `db:reset-demo` **replaces** the demo data, deletes any audit plans and
   scores every bin; see [Demo data](#demo-data) and [Risk score](#risk-score).

5. Start the API and the web app together (Ctrl+C stops both):

   ```
   npm run dev
   ```

   - Web: <http://localhost:3000> (warehouse grid; select a bin for its
     detail), <http://localhost:3000/tasks> (audit tasks) and
     <http://localhost:3000/count> (count a bin)
   - API: <http://localhost:3001/warehouse> and
     <http://localhost:3001/bins/A-01-03>

   On Windows, Ctrl+C makes `cmd.exe` ask `Terminate batch job (Y/N)?`
   (`¿Desea terminar el trabajo por lotes (S/N)?` in Spanish) once per
   process; answer `Y` / `S` and both apps stop.

## Demo data

`npm run db:reset-demo` builds the demo warehouse:

- 3 aisles (`A`–`C`) × 2 racks × 5 positions = **30 bins**, coded like
  `A-01-03` (aisle A, rack 1, position 3);
- 12 products, each counted in its own unit (case, bag, can, pack, box);
- opening stock put away 60 to 30 days before the reference time, then
  **30 days of activity**: putaways, picks, moves between bins and
  adjustments, unevenly spread over busy, normal and quiet bins;
- a simulated **last audit date** per bin (about a third never audited).
  It is only an antecedent: there are no audit records or results behind it.

Every change goes through the movement function, so the movement log can
rebuild every pallet and every bin's `inventoryVersion`.

**What it deletes.** It replaces **all** bins, products, pallets, movements
and scores in the target database and deletes **all audit plans, tasks and
counts** (with their count lines and unexpected pallets), in one
transaction (if anything fails, the previous data is kept). It prints how
many plans, tasks and counts it deleted, and how many counts were PASS and
FAIL: the copied scores that explained each selection and the PASS/FAIL
history are lost with them. It prints the target database (without the
password), only runs on a dedicated project database
(`smart_cycle_count` or `smart_cycle_count_<suffix>`) and is never run
automatically. Running the compiled script directly without
`--confirm-reset` is refused.

**Reproducible data.** The reference time ("now" of the demo) is the current
time unless `SEED_NOW` is set, with an explicit zone. The same generator
version, seed and `SEED_NOW` always produce the same business data:

```bash
# bash
SEED_NOW=2026-10-18T12:00:00Z npm run db:reset-demo
```

```powershell
# PowerShell
$env:SEED_NOW = "2026-10-18T12:00:00Z"; npm.cmd run db:reset-demo; Remove-Item Env:SEED_NOW
```

`SEED_NOW` can also be set in `apps/api/.env` (see `.env.example`).

**Coming from milestone 1.** `npm run db:migrate` removes the milestone 1
sample bin (`SAMPLE-BIN-01`). If the database contains any other bin, the
migration stops without changing anything.

## Risk score

Each bin gets a 0–100 **audit priority** (decisions D-010 and D-012,
formula version 2). It is a heuristic to decide what to count first,
**not** a probability of error; the weights and caps are initial values.

| Factor | Weight | Input | Cap |
|---|---|---|---|
| Time since last audit | 30 | Days since the last audit; a bin never audited counts as the maximum | 90 days |
| Activity | 25 | Putaway, pick and move movements in the window | 40 movements |
| Adjustments | 20 | Adjustment movements in the window | 5 adjustments |
| Last count result | 25 | 1 if the latest count up to the reference **failed**; 0 if it passed or the bin was never counted (shown as "unknown", not as PASS) | — |

How they are combined:

1. Each of the first three factors = `min(input ÷ cap, 1)`.
2. Score = `30 × age + 25 × activity + 20 × adjustments + 25 × last FAIL`,
   **rounded once** at the end (half up).
3. The window is the 30 days up to the reference time:
   `(reference − 30 days, reference]`, in UTC. A movement counts once for
   every bin it touches (a move counts for its source and its destination).

How counts feed back: any count sets the bin's last audit date (age goes
back to 0); a FAIL adds 25 until a later count of that bin passes.

Example (`B-02-03` in the demo with `SEED_NOW=2026-10-18T12:00:00Z`, never
counted): 84.03 days since the last audit → 28.01; 38 movements → 23.75;
4 adjustments → 16.00; last result unknown → 0; total 67.76 → **68**.
With no counts, the demo has no bin in the high band (0 high, 9 medium,
21 low); a bin gets there mainly through a FAIL.

Priority bands, always shown with the number and a label: **0–39 low**
(green), **40–69 medium** (yellow), **70–100 high** (red). The number of
pallets is shown as context but is not a factor, so an empty bin can still
need an audit.

**When scores are computed.** `npm run db:reset-demo` scores every bin with
its own reference time. The **Recompute scores** button (or
`POST /scores/recompute`) scores every bin for the current time, and so does
every saved count, for the count's time. Each time all inputs are read and
all scores replaced in one transaction: every bin gets its new score, or
none does. Recomputes take turns, so one never overwrites another's
result. Only the latest score is kept, with a
breakdown that reproduces it (reference time, formula version, inputs,
weights, caps and contributions); the bin page shows it under "Why this
score".

Note: with an old `SEED_NOW`, recomputing for the current time (the button
or a count) makes the audits look older and moves the 30-day window past
the demo activity.

Scores stored by milestones 3 and 4 are formula version 1 until the next
recompute; task copies keep the version they were made with.

**Coming from milestone 2.** After `npm run db:migrate`, bins have no score
until you press **Recompute scores** or run `npm run db:reset-demo`.

## Audit plans

**Create plan** on the warehouse page (or `POST /audit-plans`) creates a
plan with the **Top N** bins to audit (decision D-011):

- `N` is a whole number from 1 to 30; 5 by default. Anything else is
  rejected with a message and no plan is created.
- Only bins with a stored score and **without a pending task** are
  considered. A score of 0 counts; scores are not recomputed automatically,
  so press **Recompute scores** first if you want current ones.
- Order: score (highest first); on a tie, a bin never audited first, then
  the oldest audit (as recorded in the score's breakdown); then bin code.
- If fewer than `N` bins are available, the plan is created with those and
  says how many were skipped and why (pending task, no score). If none is
  available, no plan is created and the message says whether no bin has a
  score yet or every scored bin already has a pending task.
- Each task keeps a **copy of the score that selected it** (value, priority,
  breakdown, formula version and times), so recomputing scores later does
  not change why the bin is in the plan.
- Tasks start as **Pending**; they become Done only through a count. There
  is no manual close.

Two requests at the same time take turns: the second one waits for the
first and then selects from the bins still available, so a bin never gets
two pending tasks.

The **Tasks** page (<http://localhost:3000/tasks>) lists the plans, newest
first, with each task's position, bin, score at selection and status: a
**Count** link while pending, then **Done · PASS** or **Done · FAIL**.

**Coming from milestone 3.** `npm run db:migrate` adds the plan tables; the
bins and scores are kept.

## Count flow

The **Count** page (<http://localhost:3000/count>), made for a phone
(decisions D-001, D-003, D-004 and D-012):

1. Type or scan the bin code (a scanner that types like a keyboard works;
   there is no camera scanning). Only a bin with a **pending task** can be
   counted.
2. The page shows the expected pallets (code, product, expected quantity
   and unit). Enter the counted quantity of **each** one; `0` if it is not
   there.
3. Add any **unexpected pallet**: its code, the quantity found and, if
   known, the product from the catalog (its unit is shown). If the product
   is unknown, the quantity is kept as "units declared, product unknown",
   without inventing a SKU or unit. At most 10.
4. Submit. **PASS** only if every quantity matches exactly and there is no
   unexpected pallet; otherwise **FAIL**. The page shows the variances and
   the bin's new score.

Saving a count stores the expected and counted quantities, closes **that**
task, sets the bin's audit date and recomputes every score, all in one
transaction. A count never changes the inventory.

- **The inventory changed** since the page was opened (a movement in the
  bin): nothing is saved. The attempt stays visible as a draft with what
  changed; **Start updated recount** opens an empty form with the current
  pallets, and every quantity is entered again.
- **The same count sent again** (for example after a lost connection)
  shows the saved count as **recovered**: nothing is saved twice. If the
  page cannot confirm whether a count was saved, it says so and offers to
  send the same count again.
- **Different quantities for a task already counted** are rejected: the
  page shows the saved result and says the new quantities were not saved.

**Coming from milestone 4.** `npm run db:migrate` adds the count tables;
bins, scores, plans and tasks are kept.

## Other commands

| Command | What it does |
|---|---|
| `npm test` | API tests against a separate PostgreSQL test database (`smart_cycle_count_test`, created and migrated automatically; the tests replace its data). Needs `npm run db:up`. |
| `npm run build` | Type-checks and builds the API and the web app. Stop `npm run dev` first: the build replaces the API's `dist/` folder, which stops the development API |
| `npm run db:down` | Stops PostgreSQL (data is kept in a Docker volume) |
| `docker compose down -v` | Stops PostgreSQL and **deletes** its data |

## How the pieces fit

```
PostgreSQL (Docker)  ←  Prisma client  ←  NestJS API :3001               ←  Next.js server :3000  ←  browser
bins, products,          PrismaService      GET /warehouse                    / (grid, recompute, create plan)
pallets, movements,                         GET /bins/:code                   /bins/[code] (detail)
bin_scores,                                 POST /scores/recompute            /tasks (audit tasks)
audit_plans,                                POST /audit-plans                 /count (count a bin)
audit_tasks, counts,                        GET /audit-tasks
count_lines,                                GET /bins/:code/count-sheet
count_unexpected_pallets                    POST /audit-tasks/:taskId/count
```

- `apps/api` owns the database: the Prisma schema, migrations, the movement
  function (`src/inventory/movements.ts`), the score formula
  (`src/scoring/formula.ts`, the only implementation) and the demo data
  generator (`src/demo-data/`), plan creation (`src/planning/`) and the count
  (`src/counting/`) live there, and it is the only app that
  connects to PostgreSQL.
- `apps/web` asks the API for data from the Next.js server; the browser never
  calls the API or sees its URL (`API_BASE_URL`).

## API

| Method and path | Response |
|---|---|
| `GET /warehouse` | `200` with aisles → racks → bins (in location order), each bin with `code`, `position`, `palletCount`, `lastAuditedAt` and `score` (`value`, `priority`, `label`, `reference`, or `null` if not scored) |
| `GET /bins/:code` | `200` with the bin's location, `inventoryVersion`, `lastAuditedAt`, its current pallets (code, quantity, product SKU, name and unit) and `score` with its `breakdown`, or `404`. The code is normalised: ` a-01-03 ` finds `A-01-03` |
| `POST /scores/recompute` | `200` with the reference time, the number of bins scored and how many fall in each priority band. All scores or none are saved |
| `POST /audit-plans` with JSON `{"n": 5}` (`n` optional, default 5) | `201` with the plan (`requestedCount`, `createdCount`, `excluded.pendingTask`, `excluded.noScore`) and its tasks (rank, bin code, copied score). `400` `INVALID_N` for an `n` that is not a whole number from 1 to 30; `409` `NO_SCORES` or `NO_AVAILABLE_BINS` when no plan can be created. The plan and its tasks are saved together or not at all |
| `GET /audit-tasks` | `200` with every task, newest plan first and by rank, each with its plan summary, bin code, status, the score copied at selection (with `computedAt` and `formulaVersion`) and its `count` (`result`, `countedAt`, or `null`) |
| `GET /bins/:code/count-sheet` | `200` with the bin's pending task, `inventoryVersion`, expected lines (pallet code, product, expected quantity) and the product catalog, read in one snapshot. `404` `BIN_NOT_FOUND`; `409` `NO_PENDING_TASK` |
| `POST /audit-tasks/:taskId/count` with JSON `{"inventoryVersion": 46, "lines": [{"palletCode": "P-0026", "countedQuantity": 33}], "unexpected": [{"code": "X-1", "quantity": 12, "productSku": null}]}` | `201` with the count (result, lines with expected, counted and variance, unexpected pallets) and the bin's new score; `200` with `recovered: true` and the stored count for an identical retry. `400` (`INVALID_COUNT`, `LINES_MISMATCH`, `UNEXPECTED_IS_EXPECTED`, `UNKNOWN_PRODUCT`); `404` `TASK_NOT_FOUND`; `409` `INVENTORY_CHANGED` (nothing saved; with the current version, lines and `changes`) or `TASK_ALREADY_COUNTED` (with the stored count) |

## Project documents

| File | Contents |
|---|---|
| [`DECISIONS.md`](DECISIONS.md) | Product and technical decisions, with their status (accepted, proposed, deferred) |
| [`PROGRESS.md`](PROGRESS.md) | What is implemented, per milestone |
| [`VERIFICATION.md`](VERIFICATION.md) | Commands actually executed, per environment, and their results |
| [`HANDOFF.md`](HANDOFF.md) | Historical snapshot of the project state on 2026-10-17 |
