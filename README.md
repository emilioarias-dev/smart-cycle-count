# Smart Cycle Count Scoring

A small app that helps warehouse teams decide which bins to audit first: each
bin gets a 0–100 risk score with an explanation, shown on a color-coded
heatmap, and audits feed back into the score.

Stack: Next.js (web) + NestJS (API) + Prisma + PostgreSQL, in an npm
workspaces monorepo.

## Status

**Milestone 1 (walking skeleton):** one sample bin stored in PostgreSQL, read
by the NestJS API through Prisma, and shown by the Next.js web app. Scoring,
heatmap, audit plans and the count flow come in later milestones. See
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

4. Generate the Prisma client, apply the migrations and load the sample data:

   ```
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   ```

   The seed is idempotent: running it again keeps exactly one sample bin.

5. Start the API and the web app together (Ctrl+C stops both):

   ```
   npm run dev
   ```

   - Web: <http://localhost:3000>
   - API: <http://localhost:3001/bins/SAMPLE-BIN-01>

## Other commands

| Command | What it does |
|---|---|
| `npm test` | API tests against a separate PostgreSQL test database (`smart_cycle_count_test`, created and migrated automatically). Needs `npm run db:up`. |
| `npm run build` | Type-checks and builds the API and the web app |
| `npm run db:down` | Stops PostgreSQL (data is kept in a Docker volume) |
| `docker compose down -v` | Stops PostgreSQL and **deletes** its data |

## How the pieces fit

```
PostgreSQL (Docker)  ←  Prisma client  ←  NestJS API :3001  ←  Next.js server :3000  ←  browser
     bins table           PrismaService      GET /bins/:code       page.tsx (fetch)
```

- `apps/api` owns the database: the Prisma schema, migrations and seed live
  there, and it is the only app that connects to PostgreSQL.
- `apps/web` asks the API for data from the Next.js server; the browser never
  calls the API or sees its URL (`API_BASE_URL`).

## API

| Method and path | Response |
|---|---|
| `GET /bins/:code` | `200` with `{ "id": 1, "code": "SAMPLE-BIN-01" }`, or `404` if no bin has that code |

## Project documents

| File | Contents |
|---|---|
| [`DECISIONS.md`](DECISIONS.md) | Product and technical decisions, with their status (accepted, proposed, deferred) |
| [`PROGRESS.md`](PROGRESS.md) | What is implemented, per milestone |
| [`VERIFICATION.md`](VERIFICATION.md) | Commands actually executed, per environment, and their results |
| [`HANDOFF.md`](HANDOFF.md) | Historical snapshot of the project state on 2026-10-17 |
