# Verification log

Commands actually executed and their real results, per environment. Nothing
listed under "Pending" should be read as passing. Decisions are in
`DECISIONS.md`; implementation status is in `PROGRESS.md`. Checks before
2026-10-18 are recorded in `HANDOFF.md` §7.

## Environments

| ID | Environment | Notes |
|---|---|---|
| CC | Claude Code cloud container (development and first verification) | Linux; ephemeral: installed tools and the Docker daemon do not survive a new container |
| WIN | Author's Windows PC (reproduction, E-001) | Windows x64, Windows PowerShell |
| CAI | claude.ai session workspace (before 2026-10-17) | Historical only; see `HANDOFF.md` §5A and §7.1 |

## 2026-10-18 — CC: environment characterisation

| Command / action | Result |
|---|---|
| `uname -srm`; `/etc/os-release`; `bash --version` | Linux 6.18.44 x86_64; Ubuntu 24.04.5 LTS; GNU bash 5.2.21 |
| Version checks for node, npm, git, docker, docker compose, psql, gh | Node v22.22.0 (`/opt/node22`), npm 10.9.4, git 2.43.0, Docker client 29.8.2, Compose v5.6.0, psql 16.15, gh 2.89.0 |
| `docker info` (initial) | No daemon (`/var/run/docker.sock` missing) |
| Started `dockerd` manually, then `docker info` | Server 29.8.2, storage driver overlayfs, cgroup v1; daemon ready |
| `curl` to registry.npmjs.org, nodejs.org, api.github.com, hub.docker.com, registry-1.docker.io | 200, 200, 200, 200, 401 (registry auth challenge = reachable) |
| `gh auth status` | Fails: token in `GH_TOKEN` invalid. Git traffic to GitHub goes through the session's git proxy, which supplies credentials |
| Attach repository with push access (session tool) | Accepted by the backend: confirms authorisation, **not** a demonstrated push |
| `git clone --depth 1 https://github.com/emilioarias-dev/smart-cycle-count` | "You appear to have cloned an empty repository"; branch `main`, no commits; no `AGENTS.md`/`CLAUDE.md` |
| Unauthenticated `GET api.github.com/repos/emilioarias-dev/smart-cycle-count` | 200: the repository is public |

## 2026-10-18 — CC: PostgreSQL (pinned image, E-002)

| Command | Result |
|---|---|
| `docker pull postgres:16.15@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d` | Pull complete; `Digest: sha256:ca0bd484…b641d` (digest verified) |
| `docker run --rm <image> postgres --version` | `postgres (PostgreSQL) 16.15 (Debian 16.15-1.pgdg13+2)` |
| `ss -ltnp` filtered on port 5432 | Port 5432 free |
| Throwaway container on `127.0.0.1:55432`: `pg_isready -U postgres` | `/var/run/postgresql:5432 - accepting connections` |
| `psql -h 127.0.0.1 -p 55432 -U postgres -c "select version()"` | `PostgreSQL 16.15 (Debian 16.15-1.pgdg13+2) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit` |
| `docker rm -f` of the throwaway container | Removed |

## 2026-10-18 — CC: Node.js 24.22.0 (official build)

| Command | Result |
|---|---|
| `curl https://nodejs.org/dist/index.json` | v24.22.0, 2026-10-14, npm 11.19.1, LTS `Krypton` |
| Download `node-v24.22.0-linux-x64.tar.xz`, `SHASUMS256.txt`, `SHASUMS256.txt.asc` from nodejs.org | Downloaded |
| `sha256sum -c` against `SHASUMS256.txt` | `node-v24.22.0-linux-x64.tar.xz: OK` |
| `gpgv --keyring <nodejs/release-keys gpg-only-active-keys/pubring.kbx> SHASUMS256.txt.asc` | `Good signature from "Richard Lau …"`; clear-signed content identical to `SHASUMS256.txt` |
| Extracted to `/opt/node24`; symlinks in `/root/.local/bin` (precedes `/opt/node22/bin` in `PATH`) | `node --version` → v24.22.0; `npm --version` → 11.19.1; `process.release.lts` → Krypton. Node 22.22.0 remains at `/opt/node22` |

This replaces the third-party Node repackaging used in CAI.

## 2026-10-18 — CC: npm metadata for E-004 (metadata only)

| Command | Result |
|---|---|
| `npm view <pkg>@<pin> version engines peerDependencies` for every E-004 package | All pins exist; `engines`/`peerDependencies` as recorded in E-004. Missing peers are optional (`peerDependenciesMeta`): `prettier` (schematics), `class-validator`/`class-transformer` (common), `sass`/`@playwright/test`/… (next) |
| `npm view <pkg>@<major.minor> version` per line | Each pin is still the highest release of its line |
| `npm view <pkg> dist-tags` | `prisma` latest `8.0.0-rc.23`; `typescript` latest 7.0.2; `vitest` latest 5.0.5 (new since 2026-10-17); others' latest equal the pins |
| `npm pack @nestjs/schematics@12.0.7`, read `application/files/ts-esm` | ESM template: `"type": "module"`, Vitest `^4.1.2`, Vite `^8.0.0`, TypeScript `^6.0.2`, `emitDecoratorMetadata` in `tsconfig.json`, no Vitest plugin |
| `npm view prisma@7.10.1 dependencies`; `npm view @prisma/engines@7.10.1 scripts.postinstall` | `@prisma/engines` runs `node scripts/postinstall.js` (engine download at install time); `binaries.prisma.sh` answers (HTTP 404 on `/`, i.e. reachable) |

Not executed yet: dependency resolution in this environment, installation,
compilation or execution.

## 2026-10-18 — WIN: Node.js and npm (output shared directly by the author)

| Command | Result |
|---|---|
| `node --version` | `v24.22.0` |
| `npm.cmd --version` | `11.19.1` |
| `Get-Command node,npm.cmd \| Select-Object Name,Source` | `node.exe` → `C:\Program Files\nodejs\node.exe`; `npm.cmd` → `C:\Program Files\nodejs\npm.cmd` |

## Pending

Milestone 1:

- CC: first push demonstrated (E-009).
- CC: lockfile generation, `npm ci`, migration from an empty database,
  client generation, idempotent seed, API read and 404, Next.js page and
  error state, builds, API test against real PostgreSQL, Nest DI under
  Vitest, start/stop of the dev servers (E-008).
- CC: `npm ci` with Node 22 fails early (only if E-006 is accepted).
- WIN: port 5432 free; pull and run of the pinned image; reproduction of the
  same milestone commit.

Later or optional:

- WIN: SHA-256 of the Node MSI against `SHASUMS256.txt` (the official
  checksum for `node-v24.22.0-x64.msi` is `97ebad47ad35da4b59182a5fbe9fad2b1a1836f1042b4833ff5b4b9571175088`).
- D-001 concurrency tests (count milestone).
