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

Audit plans and the count flow come in later milestones. See
[`PROGRESS.md`](PROGRESS.md).

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

   `db:reset-demo` **replaces** the demo data and scores every bin; see
   [Demo data](#demo-data) and [Risk score](#risk-score).

5. Start the API and the web app together (Ctrl+C stops both):

   ```
   npm run dev
   ```

   - Web: <http://localhost:3000> (warehouse grid; select a bin for its detail)
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

**What it deletes.** It replaces **all** bins, products, pallets and
movements in the target database, in one transaction (if anything fails,
the previous data is kept). It prints the target database (without the
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

Each bin gets a 0–100 **audit priority** (decision D-010). It is a heuristic
to decide what to count first, **not** a probability of error; the weights
and caps are initial values.

| Factor | Weight | Input | Cap |
|---|---|---|---|
| Time since last audit | 40 | Days since the last audit; a bin never audited counts as the maximum | 90 days |
| Activity | 35 | Putaway, pick and move movements in the window | 40 movements |
| Adjustments | 25 | Adjustment movements in the window | 5 adjustments |

How they are combined:

1. Each factor = `min(input ÷ cap, 1)`.
2. Score = `40 × age + 35 × activity + 25 × adjustments`, **rounded once**
   at the end (half up).
3. The window is the 30 days up to the reference time:
   `(reference − 30 days, reference]`, in UTC. A movement counts once for
   every bin it touches (a move counts for its source and its destination).

Example (`B-02-03` in the demo with `SEED_NOW=2026-10-18T12:00:00Z`):
84.03 days since the last audit → 37.35; 38 movements → 33.25;
4 adjustments → 20.00; total 90.60 → **91**.

Priority bands, always shown with the number and a label: **0–39 low**
(green), **40–69 medium** (yellow), **70–100 high** (red). The number of
pallets is shown as context but is not a factor, so an empty bin can still
need an audit.

**When scores are computed.** `npm run db:reset-demo` scores every bin with
its own reference time. The **Recompute scores** button (or
`POST /scores/recompute`) scores every bin for the current time. Either way
all inputs are read and all scores replaced in one transaction: every bin
gets its new score, or none does. Only the latest score is kept, with a
breakdown that reproduces it (reference time, formula version, inputs,
weights, caps and contributions); the bin page shows it under "Why this
score".

Note: with an old `SEED_NOW`, recomputing for the current time makes the
audits look older and moves the 30-day window past the demo activity.

**Coming from milestone 2.** After `npm run db:migrate`, bins have no score
until you press **Recompute scores** or run `npm run db:reset-demo`.

## Other commands

| Command | What it does |
|---|---|
| `npm test` | API tests against a separate PostgreSQL test database (`smart_cycle_count_test`, created and migrated automatically; the tests replace its data). Needs `npm run db:up`. |
| `npm run build` | Type-checks and builds the API and the web app |
| `npm run db:down` | Stops PostgreSQL (data is kept in a Docker volume) |
| `docker compose down -v` | Stops PostgreSQL and **deletes** its data |

## How the pieces fit

```
PostgreSQL (Docker)  ←  Prisma client  ←  NestJS API :3001     ←  Next.js server :3000  ←  browser
bins, products,          PrismaService      GET /warehouse          / (grid + recompute button)
pallets, movements,                         GET /bins/:code         /bins/[code] (detail)
bin_scores                                  POST /scores/recompute
```

- `apps/api` owns the database: the Prisma schema, migrations, the movement
  function (`src/inventory/movements.ts`), the score formula
  (`src/scoring/formula.ts`, the only implementation) and the demo data
  generator (`src/demo-data/`) live there, and it is the only app that
  connects to PostgreSQL.
- `apps/web` asks the API for data from the Next.js server; the browser never
  calls the API or sees its URL (`API_BASE_URL`).

## API

| Method and path | Response |
|---|---|
| `GET /warehouse` | `200` with aisles → racks → bins (in location order), each bin with `code`, `position`, `palletCount`, `lastAuditedAt` and `score` (`value`, `priority`, `label`, `reference`, or `null` if not scored) |
| `GET /bins/:code` | `200` with the bin's location, `inventoryVersion`, `lastAuditedAt`, its current pallets (code, quantity, product SKU, name and unit) and `score` with its `breakdown`, or `404`. The code is normalised: ` a-01-03 ` finds `A-01-03` |
| `POST /scores/recompute` | `200` with the reference time, the number of bins scored and how many fall in each priority band. All scores or none are saved |

## Project documents

| File | Contents |
|---|---|
| [`DECISIONS.md`](DECISIONS.md) | Product and technical decisions, with their status (accepted, proposed, deferred) |
| [`PROGRESS.md`](PROGRESS.md) | What is implemented, per milestone |
| [`VERIFICATION.md`](VERIFICATION.md) | Commands actually executed, per environment, and their results |
| [`HANDOFF.md`](HANDOFF.md) | Historical snapshot of the project state on 2026-10-17 |
