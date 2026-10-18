# Handoff — Smart Cycle Count Scoring

> **Historical snapshot (2026-10-17), kept unchanged below this note.** It
> describes the state when work moved from a claude.ai session to Claude Code.
> For the current state see `DECISIONS.md` (decisions), `PROGRESS.md`
> (implementation) and `VERIFICATION.md` (executed checks). Resolved since:
> the PDF is not committed (E-009); `DECISIONS.md` and `HANDOFF.md` are.

Handoff from a claude.ai session (2026-10-17) to Claude Code. This is a
summary for continuing the work; the original conversation is kept separately
by the author and remains the full record.

**State in one line:** decisions and environment research are done; **no
application code exists yet**; the GitHub repository is empty.

Companion file: `DECISIONS.md` (decision log, same date). Where the two
differ, `DECISIONS.md` is authoritative for decisions; this file is
authoritative for status and verification history.

---

## 1. Goal, author and working agreements

- **Goal:** build the take-home technical test *Smart Cycle Count Scoring*
  (source of truth: `Technical_Test.pdf`) for the author's application to an
  Associate Developer role at Rivero.
- **Author:** Emilio Arias (GitHub `emilioarias-dev`). Background in Python,
  SQL, data analysis and automation; learning Next.js, NestJS and Prisma. He
  must be able to explain every decision and the data flow himself.
- **Mandatory stack (from the PDF):** Next.js + NestJS + Prisma + PostgreSQL.
- **Expected quality:** a working, fluid, visually polished app. The data
  contribution should help understand and improve operational decisions,
  with explicit assumptions and limitations.

Working agreements:

- Conversation with the author is in **Spanish**. Code, UI and delivery
  documentation are in **English**.
- Work in **small milestones**, each with acceptance criteria and relevant
  checks.
- **Report only commands actually executed and their real results.** If
  something cannot be executed in the current environment, say so.
- Important bugs are reproduced, fixed and covered by a regression check
  where appropriate.
- Small, descriptive commits per milestone. Commit sources, migrations, the
  lockfile and documentation. Never commit `.env`, credentials,
  `node_modules` or temporary files. Include a `.env.example` without
  secrets.
- Do not reopen accepted decisions or close deferred ones without the author.

---

## 2. Requirements from the PDF (explicit)

These come from `Technical_Test.pdf` and are not our choices.

| Area | Requirement |
|---|---|
| Purpose | Help warehouse teams decide which bins to audit first by giving each bin a risk score (higher = more likely to have mistakes), shown on a color-coded heatmap. |
| Seeded data | A small warehouse with aisles, racks and about 30 bins. Fake pallets with products, assigned to bins. Simulate the last month of activity: putaway, pick (removal), adjustment or move between bins. |
| Scoring | Score 0–100 per bin from factors we choose (examples: time since last audit; number of picks/moves/putaways; adjustment frequency; any other useful factor). Save the score **and the factor breakdown** so the UI can show "why". A button or endpoint to recompute scores. |
| Heatmap dashboard | Bins in a simple grid per aisle/rack, colored green → yellow → red by score. Clicking a bin opens a drawer/page with current score, last audit date and the pallets stored in it. The goals section also asks to see "why" the bin got its score. |
| Audit plan & tasks | "Create Plan → Top N risky bins" button. Bins saved as tasks with status `PENDING`/`DONE`. Simple table view of tasks. |
| Count flow | Mobile-friendly page: search or scan a bin code, show expected pallets, enter counted quantity and mark as audited, pass/fail, save the result and trigger a score recompute. |
| Deliverables | Running app (Next.js + NestJS) with DB schema and seed script, simple scoring service, heatmap page and bin details, audit plan creation and task view, mobile count flow. `README.md` covering install, seed and run, plus the scoring factors used and how they are combined. |

Main user journey (summary used in the conversation): supervisor opens the
heatmap → clicks a red bin and sees score, breakdown, last audit and pallets →
generates a Top N plan → operator opens the count page on mobile, enters the
bin code, counts and submits → the system records PASS/FAIL, marks the task
`DONE` and recomputes → the heatmap reflects the change.

"Have the system get smarter" in the PDF is concretely only: save count
results and recompute scores. It was agreed to present this as rule-based
feedback (an audit resets time-since-audit; FAILs raise risk), not as machine
learning.

---

## 3. Our decisions (see `DECISIONS.md` for full text)

### 3.1 Accepted — business rules

| ID | Summary |
|---|---|
| D-001 | Expected inventory = what the operator saw when **opening** the count. Each bin has an integer `inventoryVersion`, incremented by every movement touching the bin in the same transaction. Submission sends the version shown; the server locks the bin row (`SELECT … FOR UPDATE`) and compares. Same version → copy expected values into the count lines, compute PASS/FAIL, task `DONE`, recompute score. Different version → `409 Conflict` with the current expected lines; no count stored, task stays `PENDING`, score untouched; the client keeps entered quantities, highlights changed lines and **never resubmits automatically**. All inventory changes go through one movement function. Three concurrency tests are required (movement between open and submit; movement wins the lock during save; submission wins the lock during save). |
| D-002 | Each audit task stores a **copy** of the score, factor breakdown and computation timestamp that put its bin in the Top N. |
| D-003 | One SKU per pallet. Count = non-negative integer units **per expected pallet**; every expected pallet needs a value (not found = `0`). The operator can flag **unexpected pallets**. PASS iff all quantities match exactly (tolerance 0) **and** no unexpected pallet is flagged. The system derives the result. Count lines store expected, counted and variance. |
| D-004 | A count records discrepancies and never adjusts inventory (no automatic adjustments). |
| D-005 | Only the latest score per bin is stored (overwritten on recompute). |

### 3.2 Environment decisions

| ID | Summary | Status |
|---|---|---|
| E-001 | Develop and verify in one environment, reproduce each milestone on the author's Windows PC. | Accepted; **must be re-confirmed for the Claude Code environment** |
| E-002 | PostgreSQL 16 via `docker-compose`, image `postgres:16.15@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d`. | Accepted; image pin proposed and not yet pulled anywhere |
| E-003 | npm workspaces (`apps/api`, `apps/web`), one root `package-lock.json`, `npm ci`, exact pins, no `--force` / `--legacy-peer-deps`, never select by dist-tag. | Accepted |
| E-004 | Exact versions (section 6). | Proposed |
| E-005 | API is ESM (`"type": "module"`, `.js` relative imports, Prisma `moduleFormat = "esm"`), tests with Vitest. | Proposed |
| E-006 | `.nvmrc` / `.node-version` = `24.22.0`; `packageManager: npm@11.19.1`; engines `node >=24.22.0 <25`, `npm >=11.19.1 <12`; `engine-strict=true`. | Proposed |
| E-007 | `.env` git-ignored, `.env.example` committed; API loads `.env` with `dotenv` in its entry point and in `prisma.config.ts`; web reads the API base URL from an env variable. | Proposed |
| E-008 | Cross-platform npm scripts (project-local binaries only, no shell-specific syntax), `concurrently` for dev servers, `.gitattributes` `* text=auto eol=lf`, `.gitignore` as listed in `DECISIONS.md`. | Proposed |
| E-009 | Repository and push. | Pending (section 9) |

"Proposed" means the author has not explicitly accepted it yet. Confirm E-004
to E-008 with the author before or while building milestone 1.

### 3.3 Deferred (decide when the corresponding milestone starts)

- Warehouse layout and bin code format. Codes like `A1-R1-B03` in the
  conversation and in `DECISIONS.md` are illustrative only.
- Movement semantics (putaway, pick, move, adjustment).
- Inventory representation and seed design (determinism, reference date,
  prior audit history).
- Scoring factors, weights, window and normalisation.
- Plan rules (default N, tie-break, bins with pending tasks).
- Unexpected pallet capture details.

Ideas raised in the conversation for these, **not decided**: 3 aisles × 2
racks × 5 bins; pick decrements units; inventory stored as current state plus
a consistent movement log that can be replayed; seeded PRNG with dates
relative to run time (`SEED_NOW` override); some bins with prior audits and
some never audited.

### 3.4 Optional improvements (not in scope unless the author decides)

Camera barcode scanning (a text field already works with keyboard-wedge
scanners); before/after score comparison and history (conflicts with D-005 as
it stands); evaluating the score with hidden simulated discrepancies
(precision@N vs random selection); blind count; configurable weights;
reconciliation/approval of adjustments; full Docker Compose for all
services; CI; end-to-end tests; a dev-only "simulate movement" button to
demonstrate the D-001 conflict path.

---

## 4. Preferred architecture (proposed in conversation; not built)

- Monorepo with npm workspaces: `apps/web` (Next.js), `apps/api` (NestJS).
  No Nx/Turborepo. No shared types package at the start.
- `docker-compose.yml` runs PostgreSQL only.
- **Prisma lives only in the API.** Next.js consumes the API and never
  touches the database, so business rules have one home.
- **Scoring is a pure function** separate from NestJS, e.g.
  `scoreBin(features, now, config) → { score, factors[] }`, unit-tested
  without a database. Features are gathered with SQL aggregates.
- NestJS modules: `PrismaModule` (connection), `WarehouseModule` (layout,
  bins, bin detail with pallets), `ScoringModule` (feature extraction, pure
  scoring, persist score; `POST /scores/recompute`), `AuditModule` (plans,
  tasks, counts; triggers recompute after a count).

Data flow as discussed (target, not built):

```
seed (30 days of movements) → inventory state (pallet ↔ bin)
  → per-bin features (SQL aggregates)
  → pure scoring function → bin score {score, breakdown, computedAt}
  → GET /bins → heatmap / bin detail
  → POST /audit-plans {n} → tasks PENDING (with score copy, D-002)
  → open count: expected lines + inventoryVersion
  → submit count (D-001 check) → lines with expected/counted/variance → PASS/FAIL
  → task DONE → recompute → updated heatmap
```

---

## 5. Environments — keep them distinct

### A. claude.ai session workspace (where this handoff was written)

Not transferable; nothing installed here carries over to Claude Code.

- Ubuntu 24.04.5 LTS, x86_64.
- Originally Node v22.22.0 (`/opt/node22`), npm 10.9.4. Node **24.22.0** and
  npm **11.19.1** were added at `/opt/node24` and made the default via
  symlinks in `~/.npm-global/bin`. The Node binary comes from the npm package
  `node-linux-x64@24.22.0`, a **third-party repackaging** (`node-bin-gen`),
  because `nodejs.org` is blocked here.
- PostgreSQL 16.15 server binaries present (native); Docker CLI present but
  **no Docker daemon**.
- Network: npm registry and GitHub (including raw.githubusercontent.com)
  reachable; `nodejs.org`, `hub.docker.com` and `registry-1.docker.io` refused
  by the egress proxy.
- `gh` CLI token invalid. The GitHub repository was attached to this session
  and cloned read-only; the session's push check was **refused**.

### B. Claude Code environment (next)

**Unknown at handoff.** Before milestone 1, establish and report: OS; Node
and npm versions (target 24.22.0 / 11.19.1); whether PostgreSQL 16.15 can run
(Docker or native); network access to the npm registry, GitHub and Docker
Hub; GitHub write access to the repository. E-001 must be re-confirmed for
this environment.

### C. Author's Windows PC

Windows x64. The author uses Windows PowerShell (its banner suggests
installing the newer PowerShell, so it is not PowerShell 7); the exact version
was not checked.

| Item | State | Evidence |
|---|---|---|
| Node / npm | **v24.22.0 / 11.19.1**, LTS `Krypton`; `node` and `npm` resolve to `C:\Program Files\nodejs\` | Output shared by the author after installing the official MSI |
| Git | 2.54.0.windows.1 | Output shared |
| Docker | Docker 29.8.2, Compose v5.6.0, engine running, `hello-world` OK | Output shared |
| Install-method note | winget lists the Node install under the ID `OpenJS.NodeJS.22` (now showing 24.22.0); do not run `winget upgrade` on that ID | Output shared |
| Claude desktop link | The session was linked to this PC through the Claude desktop app; no folders were connected | Device info read in session |

---

## 6. Versions (E-004, proposed) and how they were selected

| Package | Exact version |
|---|---|
| Node.js / npm | 24.22.0 / 11.19.1 (npm bundled with that Node) |
| `@nestjs/common`, `core`, `platform-express`, `testing` | 12.1.3 |
| `@nestjs/cli` / `@nestjs/schematics` | 12.0.8 / 12.0.7 |
| `reflect-metadata` / `rxjs` | 0.2.2 / 7.8.2 |
| `prisma`, `@prisma/client`, `@prisma/adapter-pg` | 7.10.1 |
| `typescript` | 6.0.3 |
| `next` / `react` / `react-dom` | 16.4.2 / 19.3.1 / 19.3.1 |
| `@types/react` / `@types/react-dom` / `@types/node` | 19.3.0 / 19.3.0 / 24.19.2 |
| `vitest` / `vite` | 4.1.12 / 8.3.4 |
| `supertest` / `@types/supertest` / `@types/express` | 7.3.1 / 7.2.1 / 5.0.6 |
| `dotenv` / `concurrently` | 18.0.8 / 10.0.6 |
| PostgreSQL image | `postgres:16.15@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d` |

Sources consulted: npm registry metadata (`npm view … version engines
peerDependencies dependencies dist-tags`), the Node.js release schedule and
`CHANGELOG_V24.md` from the `nodejs` GitHub organisation, the
`@nestjs/schematics@12.0.7` package contents (`npm pack`), the Prisma ORM v7
upgrade guide, Prisma's NestJS v7 guide and generators reference, the NestJS
Prisma recipe, and the Docker Hub tags API. Declared compatibility per package
is in `DECISIONS.md` E-004.

---

## 7. Verifications executed

Only checks that were actually run. "Web tool" means read through a
summarising web-fetch tool, not a command.

### 7.1 claude.ai session workspace (Linux)

| Command / action | Result |
|---|---|
| `uname -srm`; `/etc/os-release`; version checks for node, npm, pnpm, yarn, git, docker, psql | Ubuntu 24.04.5; Node v22.22.0, npm 10.9.4, pnpm 10.28.0, yarn 1.22.22, git 2.43.0, Docker client 29.8.2, psql 16.15 |
| `docker info` | Failed: no `/var/run/docker.sock` (no daemon) |
| Temporary PostgreSQL: `initdb`, `pg_ctl start` on port 5433, `select version()`, create DB/table/insert/select over `127.0.0.1`, stop, delete | `PostgreSQL 16.15 …`; `tcp localhost ok, row=17`; stopped and removed |
| `gh auth status` | Failed: token invalid |
| `git ls-remote https://github.com/git/git HEAD` | OK (public read works) |
| `curl` to `nodejs.org`, `hub.docker.com`, `registry-1.docker.io` | Refused by egress proxy; `raw.githubusercontent.com` returned 200 |
| `npm view` for every package in section 6 and `@angular-devkit/*` | Metadata recorded in `DECISIONS.md` E-004 |
| `npm view prisma dist-tags`, `npm view typescript dist-tags` | `prisma` latest = `8.0.0-rc.23` (prev = 7.10.1); `typescript` latest = 7.0.2 |
| `npm pack @nestjs/schematics@12.0.7` and inspection of the application templates | Schematic option `type` defaults to `esm`; the ESM template uses Vitest 4 / Vite 8 |
| Installed Node 24.22.0 (from `node-linux-x64@24.22.0`) and npm 11.19.1 (from `npm pack npm@11.19.1`) | `node --version` → v24.22.0, `npm --version` → 11.19.1, `process.release.lts` → Krypton |
| Throwaway workspace with exactly the section 6 pins: `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` | Exit 0, no `ERESOLVE`, 493 packages; single TypeScript 6.0.3, Prisma 7.10.1, React 19.3.1, Next 16.4.2; `@angular-devkit/*` at 22.2.0 and 22.2.2 |
| Engines check over that lockfile (Node script with npm's `semver`) | Node 24.22.0: 1 mismatch, optional `@img/sharp-win32-ia32` (32-bit Windows only). Node 24.14.0 and 22.22.0: 7 dev packages fail (`@nestjs/schematics`, `@angular-devkit/*`). npm 11.19.1: 0 mismatches |
| Web tool: Docker Hub tags API for `postgres` | Tags `16`, `16.15`, `16.15-trixie` share digest `sha256:ca0bd484…b641d` (last updated 2026-10-07) |
| Web tool: Prisma v7 docs and NestJS recipe | ESM by default; `moduleFormat` `esm`/`cjs` available; driver adapter mandatory (`@prisma/adapter-pg`); `.env` not loaded automatically (use `dotenv` in `prisma.config.ts`); generator `prisma-client` with required `output`; install `prisma@7` because `latest` is a v8 pre-release |
| Repository: attach with push access (first attempt) | Failed: "link your GitHub account to let Claude access repositories" |
| Repository: attach again after the author linked GitHub | Attached; **push check refused** (Claude GitHub App lacks access) |
| `git clone --depth 1 https://github.com/emilioarias-dev/smart-cycle-count` | "You appear to have cloned an empty repository"; branch `main`, no commits |

The throwaway workspace (`package.json` files and a generated
`package-lock.json`) exists only in the claude.ai session's scratchpad. It is
**not** the project lockfile and must not be reused as one.

### 7.2 Author's Windows PC (outputs shared by the author)

| Command | Result |
|---|---|
| `node --version`, `npm --version`, `git --version` (initial) | v24.14.0, 11.9.0, 2.54.0.windows.1 |
| `docker --version` (initial) | Not recognised (Docker not installed) |
| After installing Docker Desktop: `docker --version`, `docker compose version` | 29.8.2, v5.6.0 |
| `docker info`, `docker run --rm hello-world` (first try) | 500 Internal Server Error on `dockerDesktopLinuxEngine` |
| Same, after restarting and opening Docker Desktop | `29.8.2`; "Hello from Docker!" |
| `(Get-Command node).Source`; `winget list --name Node.js`; `nvm`/`fnm`/`volta --version` | `C:\Program Files\nodejs\node.exe`; `OpenJS.NodeJS.22 24.14.0 winget`; nvm, fnm and volta not installed |
| After installing the official `node-v24.22.0-x64.msi`: `node --version`, `npm --version`, `node -p "process.release.lts"`, `Get-Command` sources, `winget list` | v24.22.0; 11.19.1; Krypton; `C:\Program Files\nodejs\node.exe` and `npm.ps1`; `OpenJS.NodeJS.22 24.22.0` |

---

## 8. Pending checks

Nothing below has passed.

**Claude Code environment**

- Characterise the environment (section 5B) and re-confirm E-001.
- Node 24.22.0 / npm 11.19.1 available.
- PostgreSQL 16.15 available (Docker with the pinned image, or native).
- GitHub write access to `emilioarias-dev/smart-cycle-count` (first push).

**Author's Windows PC**

- Port 5432 free (`Get-NetTCPConnection -LocalPort 5432 -State Listen`).
- `docker pull` and run of the pinned image; `pg_isready`;
  `select version()` → 16.15. This also verifies the digest.
- SHA-256 of the Node MSI against `SHASUMS256.txt`: the commands were given
  but the output was not shared, so it is not recorded as passed.
- `npm ci`, builds, tests and running the apps for each milestone.

**Project-level**

- First real `npm ci` from a committed root lockfile (none exists yet).
- E-006: `npm ci` with a wrong Node version fails early.
- TypeScript 6.0.3 builds for NestJS 12 and Next.js 16.
- NestJS decorators/DI working under Vitest 4 + Vite 8 (the Nest ESM template
  relies on this; not run here).
- Prisma 7.10.1 client generation, migrations and queries through
  `@prisma/adapter-pg` against PostgreSQL 16.15.
- On Windows, the optional 32-bit `sharp` package is skipped by `npm ci`
  under `engine-strict`.
- D-001 concurrency tests (only when counts are implemented).

---

## 9. Repository, authentication and GitHub transfer

- Repository: `https://github.com/emilioarias-dev/smart-cycle-count`,
  created by the author; **empty** at handoff (branch `main`, no commits).
- From the claude.ai session: read and clone worked; the push check was
  **refused** (the Claude GitHub App has no access to the repository). No
  push was attempted. Fix suggested to the author: install the Claude GitHub
  App for this repository (github.com/apps/claude) or re-link GitHub from
  claude.ai.
- The author reports having connected the repository to Claude Code. **Not
  verified.** First action in Claude Code: confirm the remote, then
  demonstrate a push with the first real commit. Report the exact result.
- Fallback if pushing is not possible: commit locally and hand over a
  `git bundle` for the author to push from Windows.
- Not yet in the repository: `DECISIONS.md`, `HANDOFF.md` and
  `Technical_Test.pdf`. Ask the author whether the PDF should be committed
  (it may be confidential); the two Markdown files are intended for the
  repository.

---

## 10. Known version and compatibility issues

- **Node 24.14.0 is not enough.** `@nestjs/schematics` 12.0.7 and
  `@angular-devkit/*` 22.2.x require `^24.15.0` on the 24 line (`^22.22.3` on
  22). Solved on Windows by installing 24.22.0.
- **Prisma dist-tag trap:** `npm install prisma` would install
  `8.0.0-rc.23`. Always pin `7.10.1`. `@prisma/client` and
  `@prisma/adapter-pg` `latest` are 7.10.1, but pin them anyway.
- **TypeScript dist-tag trap:** `latest` is 7.0.2; `@nestjs/cli` 12.0.8
  depends on `typescript ~6.0.2`. Use 6.0.3.
- **npm 12** exists (npm prints an upgrade notice). Stay on 11.19.1, the
  version bundled with Node 24.22.0.
- **ESM:** Prisma 7 generates ESM by default; its CommonJS output is
  available via `moduleFormat = "cjs"`. NestJS 12 defaults to ESM with Vitest.
  Mixing CommonJS Nest with the ESM Prisma client breaks (`import.meta`).
  Many tutorials are CommonJS/Jest and do not apply directly (E-005).
- **Prisma 7 configuration:** driver adapter mandatory, generator
  `prisma-client` with required `output`, client imported from the generated
  path (not `node_modules`), `prisma.config.ts` required, `.env` not loaded
  automatically.
- **Duplicate `@angular-devkit/*`** (22.2.0 from the CLI, 22.2.2 from the
  schematics): expected, harmless.
- **Node 24 lifecycle:** maintenance LTS from 2026-10-20; end of life
  2028-04-30. Node 26 becomes Active LTS on 2026-10-28. Node 24 was the
  author's explicit choice.
- **Very recent releases:** Prisma 7.10.1 (2026-10-15), Next.js 16.4.2
  (2026-10-15), Vitest 4.1.12 (2026-10-15), React 19.3.1 (2026-10-14), Node
  24.22.0 (2026-10-14). If a regression appears, consider the previous patch
  of the same line and record the change.
- **Windows winget mapping:** Node is listed under `OpenJS.NodeJS.22`. Do not
  run `winget upgrade` on that ID.

---

## 11. Contradictions and information that could not be confirmed

- **Milestone 1 scope changed.** The first plan in the conversation proposed
  milestone 1 as "full schema + deterministic seed, no UI" with a tentative
  roadmap (scoring → heatmap → bin detail → plan/tasks → count flow →
  README/polish). The author later fixed milestone 1 as a walking skeleton
  (section 12) and deferred layout, movements and seed design. The roadmap
  after milestone 1 is **not agreed**.
- **Score history.** An early proposal stored score history (append-only).
  It was superseded by D-005 (latest only); D-002 therefore copies the score
  into tasks instead of referencing it.
- **Configuration loading.** The NestJS Prisma recipe uses `@nestjs/config`
  (`ConfigService`); E-007 proposes plain `dotenv`. `@nestjs/config` was not
  version-checked. Open point.
- **Lint/format tooling.** The NestJS 12 template includes `oxlint` and
  `prettier`; neither is in the proposed pins. Not decided.
- **Prisma docs on minimum Node.** The upgrade guide states Node 20.19
  minimum; the NestJS v7 guide states 22.22.3+ / 24.15+ / 26+. Node 24.22.0
  satisfies both.
- **Web-tool summaries.** The Docker digest and the Prisma/NestJS
  documentation points were read through a summarising web tool. The digest
  is verified only when a `docker pull` by digest succeeds; re-check the
  documentation directly if a detail matters.
- **Linux Node binary provenance.** Third-party npm repackaging; integrity
  checked against the npm registry, not against official Node.js checksums.
- **Windows Node MSI checksum.** Not confirmed (output not shared).
- **Docker Desktop install command on Windows.** The author reported the
  installation succeeded; the install command output was not shared.
- **GitHub access from Claude Code.** Reported by the author, not verified.

---

## 12. Milestone 1 — agreed scope and proposed acceptance criteria

**Scope (agreed with the author):** one bin persisted in PostgreSQL, read
through Prisma and NestJS, and shown in Next.js. No scoring, heatmap, plans or
counts.

Constraints for this milestone:

- Do not decide deferred items. Keep the `Bin` model minimal (for example an
  id and a code) and label the stored bin as sample data. The code format,
  layout and inventory fields (including `inventoryVersion`) come in later
  milestones through new migrations.
- Apply E-003 now. Apply E-004 to E-008 once the author confirms them (they
  are proposed).

Proposed acceptance criteria, to be confirmed by the author before starting:

1. **Structure:** root `package.json` with workspaces, a single committed
   root `package-lock.json`, `.nvmrc`/`.node-version`, `.npmrc`,
   `.gitattributes`, `.gitignore`, `.env.example` file(s) without secrets,
   `docker-compose.yml` with the pinned PostgreSQL image, `README.md`,
   `DECISIONS.md`, `HANDOFF.md`.
2. **Reproducible install:** `npm ci` at the root succeeds with Node
   24.22.0 / npm 11.19.1, without `--force` or `--legacy-peer-deps`, in the
   Claude Code environment and on Windows.
3. **Database:** PostgreSQL 16.15 is running (Compose on Windows; Compose or
   native in Claude Code); a committed Prisma migration creates the `Bin`
   table; applying migrations from scratch succeeds.
4. **Data:** a documented, idempotent command inserts exactly one sample bin;
   running it twice does not duplicate it.
5. **API:** a NestJS endpoint returns that bin as JSON, read through a
   Prisma service using `@prisma/adapter-pg`; an unknown bin returns 404.
   Covered by an automated API test against a real PostgreSQL database.
6. **Web:** a Next.js page fetches the bin from the API and displays it, with
   a clear error state when the API is unreachable.
7. **Dev workflow:** one documented command starts API and web together on
   Linux and Windows.
8. **Builds:** API and web type-check and build.
9. **Repository:** small descriptive commits; no `.env`, credentials,
   `node_modules` or temporary files; push demonstrated, or a `git bundle`
   handed over.
10. **Evidence:** the milestone report lists the commands actually executed
    in each environment with their results, and the Windows reproduction is
    recorded separately from the Claude Code run.
