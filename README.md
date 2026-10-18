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
  single movement function; a neutral warehouse grid and a bin detail page.

Scoring and risk colors, audit plans and the count flow come in later
milestones. See [`PROGRESS.md`](PROGRESS.md).

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

   `db:reset-demo` **replaces** the demo data; see [Demo data](#demo-data).

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
bins, products,          PrismaService      GET /warehouse          / (grid)
pallets, movements                          GET /bins/:code         /bins/[code] (detail)
```

- `apps/api` owns the database: the Prisma schema, migrations, the movement
  function (`src/inventory/movements.ts`) and the demo data generator
  (`src/demo-data/`) live there, and it is the only app that connects to
  PostgreSQL.
- `apps/web` asks the API for data from the Next.js server; the browser never
  calls the API or sees its URL (`API_BASE_URL`).

## API

| Method and path | Response |
|---|---|
| `GET /warehouse` | `200` with aisles → racks → bins (in location order), each bin with `code`, `position`, `palletCount` and `lastAuditedAt` |
| `GET /bins/:code` | `200` with the bin's location, `inventoryVersion`, `lastAuditedAt` and its current pallets (code, quantity, product SKU, name and unit), or `404`. The code is normalised: ` a-01-03 ` finds `A-01-03` |

## Project documents

| File | Contents |
|---|---|
| [`DECISIONS.md`](DECISIONS.md) | Product and technical decisions, with their status (accepted, proposed, deferred) |
| [`PROGRESS.md`](PROGRESS.md) | What is implemented, per milestone |
| [`VERIFICATION.md`](VERIFICATION.md) | Commands actually executed, per environment, and their results |
| [`HANDOFF.md`](HANDOFF.md) | Historical snapshot of the project state on 2026-10-17 |
