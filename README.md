# Smart Cycle Count Scoring

A small app that helps warehouse teams decide which bins to audit first.
Every bin gets a 0–100 risk score with an explanation, shown on a
color-coded warehouse heatmap. A supervisor creates an audit plan with the
riskiest bins, an operator counts them on a phone, and each result (PASS or
FAIL) feeds back into the scores.

Stack: Next.js (web) + NestJS (API) + Prisma + PostgreSQL, in an npm
workspaces monorepo.

**All data is synthetic.** The warehouse, products, pallets, movements and
the "last audit" dates come from a demo generator; the last audit dates are
simulated antecedents with no audit results behind them. Only counts entered
in the app are real records of this app.

## What you can do

- **Dashboard** (`/`): an overview band (priority mix of all bins, progress
  of the latest plan, bins never audited), a heatmap of the 30 bins by aisle
  and rack colored by audit priority (green low, yellow medium, red high),
  the latest plan with each bin's score at selection and now, and a
  **Score breakdown · Top 5 bins** chart. The heatmap opens in 2D; a **3D**
  view of the same bins can be chosen. At the bottom, **Audit insights**:
  what part of the warehouse was counted in the last 30 days and what the
  counts found.
- **Bin detail** (`/bins/A-01-03`): the score and why it got it, the last
  audit date and the pallets stored in the bin.
- **Create plan → Top N** (on the dashboard): saves the riskiest bins as
  audit tasks, `PENDING` until counted. **Tasks** (`/tasks`) lists them.
- **Count** (`/count`, made for a phone): find a bin with a pending task,
  enter the counted quantity of each expected pallet, record unexpected
  pallets and get PASS or FAIL. The task becomes `DONE` and every score is
  recomputed with the result.
- **Recompute scores** (on the dashboard): scores every bin for the current
  time; the heatmap updates.
- **Rivy** (`/rivy`): a read-only assistant on Google Gemini that explains a
  bin's priority, compares two bins, looks up count results and answers
  questions about the rules, using only the app's records. Optional: needs
  a Gemini API key (see [Rivy](#rivy)); without one, the rest of the app
  works as usual.

## Requirements

- Node.js **24.22.0** and npm **11.19.1** (the npm bundled with that Node
  release). Any later 24.x works; other major versions are rejected by
  `npm ci` (`engine-strict`).
- Docker with Docker Compose (for PostgreSQL 16.15).
- Free local ports: `5433` (PostgreSQL container), `3001` (API) and `3000`
  (web). The container uses host port 5433 so it does not collide with a
  PostgreSQL already installed on the machine (usually on 5432), which is
  left untouched.

## Install and run

Run every command from the repository root. Commands are the same in bash
and PowerShell except where two variants are shown (in PowerShell,
`npm.cmd` can be used instead of `npm`).

### 1. Install the dependencies

Installs the exact dependency tree from the lockfile:

```
npm ci
```

### 2. Configure

Create the local environment files from the templates. They hold local
development values only, no secrets:

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

- `apps/api/.env`: `DATABASE_URL` (the development database),
  `TEST_DATABASE_URL` (a separate database for the tests), `PORT` (3001)
  and, optionally, `SEED_NOW` (see [Demo data](#demo-data)) and the Gemini
  settings for Rivy (see [Rivy](#rivy)). The template has no key: Rivy
  says it is not configured until you add yours.
- `apps/web/.env`: `API_BASE_URL`, read only on the Next.js server; the
  browser never calls the API directly.

### 3. Start PostgreSQL

```
npm run db:up
```

It waits until the database is healthy. `docker compose ps` should show the
`db` service as `healthy` with `127.0.0.1:5433->5432/tcp`.

### 4. Create the database schema

Generate the Prisma client and apply the migrations:

```
npm run db:generate
npm run db:migrate
```

### 5. Load the demo data

> **Warning: this deletes data.** `npm run db:reset-demo` deletes **all**
> bins, products, pallets, movements and scores, and **all audit plans,
> tasks and counts with their PASS/FAIL history**, in the database of
> `DATABASE_URL`, and rebuilds the demo warehouse. Deleted plans and counts
> cannot be recovered. It only runs on a database named `smart_cycle_count`
> or `smart_cycle_count_<suffix>`, prints the target database before
> starting, and keeps the previous data if anything fails.

`db:reset-demo` is the project's seed command:

```
npm run db:reset-demo
```

It ends by printing what it built and what it deleted, for example:

```
Demo data replaced: 30 bins (2 empty, 11 never audited), 12 products, 110 pallets (27 depleted), movements: …
Deleted 0 audit plans and 0 tasks, with their selection explanations.
Deleted 0 counts (0 PASS, 0 FAIL) with 0 count lines and 0 unexpected pallets.
Scores computed for 30 bins at the same reference: …
```

To get exactly the data used in the examples of this README, set the
reference time (see [Demo data](#demo-data)):

```bash
# bash
SEED_NOW=2026-10-18T12:00:00Z npm run db:reset-demo
```

```powershell
# PowerShell
$env:SEED_NOW = "2026-10-18T12:00:00Z"; npm.cmd run db:reset-demo; Remove-Item Env:SEED_NOW
```

**High-risk scenario (optional).** `npm run db:reset-demo-high-risk` loads
the same warehouse with a few bins that really reach the high band (see
[Demo data](#demo-data)). It deletes the same data as `db:reset-demo`; run
`db:reset-demo` to go back to the original demo. `SEED_NOW` works the same
way.

### 6. Start the app

Starts the API and the web app together:

```
npm run dev
```

- Web: <http://localhost:3000>
- API: <http://localhost:3001/warehouse> (see [API](#api))

Ctrl+C stops both. On Windows, `cmd.exe` asks `Terminate batch job (Y/N)?`
(`¿Desea terminar el trabajo por lotes (S/N)?` in Spanish) once per
process; answer `Y` / `S`.

To stop PostgreSQL: `npm run db:down` (the data is kept in a Docker volume).

## Walkthrough

With the demo data loaded and `npm run dev` running:

1. **Dashboard** — open <http://localhost:3000>. Each bin shows its score,
   its priority label and its pallets, colored by band; a **TASK** marker
   means a pending task, **PASS** / **FAIL** the bin's count in the latest
   plan. "Scores as of" gives the reference time of the scores. The
   **Score breakdown · Top 5 bins** chart stacks the points of each factor
   on one 0–100 scale: hover or focus a bar for its values, or click / tap
   it to open them under the bar.

   **3D** (above the heatmap) shows the same 30 bins, scores, bands and
   "Scores as of" as short columns: height and color give the score on one
   0–100 scale; a 0 keeps a base; a dashed flat tile has no score. Rows are
   racks (`A-01` … `C-02`), columns positions (`01`–`05`). A click, a tap or
   the bin list selects a bin and keeps its details (score, band, pallets,
   task or last result in the latest plan, link to the bin). With a mouse,
   drag to move and Ctrl + scroll to zoom; on a phone, one finger scrolls
   the page as usual and two fingers move and zoom. **+**, **−** and the
   house button (Reset view) stay in the corner of the view. **2D** goes
   back; if 3D cannot start (no WebGL), the 2D heatmap comes back with a
   notice.
2. **Why a score** — select a bin. Its page shows the score with each
   factor (input, cap, weight, points, and a bar on the same 0–100 scale),
   the last audit date, the last count result and the pallets in the bin.
3. **Plan** — back on the dashboard, set **Top N** (5 by default) and press
   **Create plan**. The message says how many tasks were created; **Tasks**
   lists them with the score that selected each bin.
4. **Count** — open **Count** (on a phone or a narrow window), type a code
   from the plan, enter each counted quantity (`0` for a missing pallet),
   optionally add an unexpected pallet, and submit. The page shows PASS or
   FAIL, the quantities and variances in the product's unit, and the bin's
   new score; **Tasks** shows the task as **Done** with its result.
5. **Recompute** — on the dashboard, press **Recompute scores** (on a phone,
   the full-width button above Top N): every bin is scored for the
   current time and the heatmap updates. A counted bin's age is back to 0,
   and a FAIL adds 25 points.
6. **Audit insights** — at the bottom of the dashboard (decision D-019),
   over the saved counts of all plans in the last 30 days, up to the time
   of the request (shown in UTC):
   - **Coverage**: bins with at least one count in the period / bins in the
     scope; **Counts recorded**, with PASS and FAIL; **Observed FAIL
     proportion**: FAIL counts / counts in the period ("No counts" when
     there are none, not 0 %).
   - **Scope** (All aisles, A, B, C) changes the three figures and the bars.
   - One bar per aisle splits its bins by their **latest count in the
     period**: PASS, FAIL or no count (not every count, and not only the
     latest plan). Select a part of a bar, or its label (keyboard: Tab and
     Enter), to list its bins below; this filters the list only. **Clear
     selection** empties it.

   After a reset of the demo data there are no counts: every bin is shown
   without a count until you count some.

The sun / moon button in the top bar switches between the light and dark
themes on every page; without a choice the app follows the system setting,
and the choice is remembered in that browser. On a phone, Warehouse, Tasks,
Rivy and Count are in a tab bar at the bottom of the screen.

## Demo data

`npm run db:reset-demo` builds the demo warehouse (decision D-009):

- 3 aisles (`A`–`C`) × 2 racks × 5 positions = **30 bins**, coded like
  `A-01-03` (aisle A, rack 1, position 3);
- 12 products, each counted in its own unit (case, bag, can, pack, box);
- opening stock put away 60 to 30 days before the reference time, then
  **30 days of activity**: putaways, picks, moves between bins and
  adjustments, unevenly spread over busy, normal and quiet bins;
- a simulated **last audit date** per bin (about a third never audited).
  It is only an antecedent: there are no audit records or results behind
  it, and it must not be read as a PASS.

Every inventory change goes through one movement function, so the movement
log can rebuild every pallet and every bin's `inventoryVersion`.

**Two scenarios (decision D-017).** The top bar names the one loaded.

| Scenario | Command | At `SEED_NOW=2026-10-18T12:00:00Z` |
|---|---|---|
| Original demo | `npm run db:reset-demo` | 0 high, 9 medium, 21 low (unchanged) |
| High-risk demo | `npm run db:reset-demo-high-risk` | 8 high (75 to 70), 12 medium (67 to 41), 10 low (38 to 4) |

The high-risk scenario is a target to illustrate the demo, not a real
warehouse distribution: it plans each bin's inputs (days since the last
audit, movements and adjustments in the last 30 days) and produces them as
ordinary movements of real pallets. The unchanged formula, weights, bands
and colors give the spread; the tests check every score against the formula
written in SQL.

**Its reference time matters.** The spread holds at the reference ("Scores
as of"). **Recompute scores** or a count scores every bin for the current
time and moves the 30-day window: one day later about 7 bins are high,
three days later about 1, a week later none. For a live demo, load it on
the day without `SEED_NOW`; with `SEED_NOW` the data is exactly
reproducible, but a recompute moves it to today.
After a database update, the top bar shows "Scenario not recorded" until
the next reset.

**Reproducible data.** The reference time ("now" of the demo) is the
current time unless `SEED_NOW` is set, with an explicit zone. The same
generator version, seed and `SEED_NOW` always produce the same business
data. `SEED_NOW` can also be set in `apps/api/.env` (see `.env.example`).

**Protections.** The reset runs in one transaction (if anything fails, the
previous data is kept), deletes each table by name without cascading
deletes, refuses any database that is not a dedicated project database,
and is never run automatically. Running the compiled script directly
without `--confirm-reset` is refused. It reports how many plans, tasks and
counts it deleted (with how many counts were PASS and FAIL); the copied
scores that explained each selection and the PASS/FAIL history are lost
with them.

**After a reset, reload every open tab.** Pages already open still show the
data from before (and Rivy's conversation, kept in the page, refers to it);
a count form opened before the reset belongs to a task that no longer
exists, so its count is rejected.

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
none does. Recomputes take turns, so one never overwrites another's result,
and the button's current time is taken once it has its turn: a count saved
while it waited is included.
Only the latest score is kept, with a breakdown that reproduces it
(reference time, formula version, inputs, weights, caps and contributions);
the bin page shows it under "Why this score".

Note: with an old `SEED_NOW`, recomputing for the current time (the button
or a count) makes the audits look older and moves the 30-day window past
the demo activity.

## Audit plans

**Create plan** on the dashboard (or `POST /audit-plans`) creates a plan
with the **Top N** bins to audit (decision D-011):

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

The **Tasks** page lists the plans, newest first, with their progress and
each task's position, bin and score at selection. The task's **status**
(Pending or Done) and its count **result** (PASS or FAIL, only once done)
are shown apart; a pending task has a **Count** button in place of the
result.

## Count flow

The **Count** page, made for a phone (decisions D-001, D-003, D-004 and
D-012):

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
4. Submit (the button stays at the bottom of the screen; on a wide screen
   it also says how many pallets still need a quantity: a typed `0` is an
   answer, an empty field is not). **PASS** only if every quantity matches
   exactly and there is no unexpected pallet; otherwise **FAIL**. The
   result is derived from the numbers, not chosen by the operator. The page
   shows expected and counted quantities and the variances in each
   product's unit, and the bin's new score.

Saving a count stores the expected and counted quantities, closes **that**
task, sets the bin's audit date and recomputes every score, all in one
transaction. A count never changes the inventory.

- **The inventory changed** since the page was opened (a movement in the
  bin): nothing is saved. The attempt stays visible as a draft with what
  changed; **Start updated recount** opens an empty form with the current
  pallets, and every quantity is entered again.
- **The same count sent again** (for example after a lost connection)
  shows the saved count as **recovered**: nothing is saved twice. If the
  page cannot confirm whether a count was saved ("Result unknown"), the
  quantities stay as they were sent and **Send the same count again**
  resends exactly them; **Change quantities** starts a new count instead,
  which is rejected if the first one was saved.
- **Different quantities for a task already counted** are rejected: the
  page shows the saved result and says the new quantities were not saved.

## Rivy

Rivy (decision D-016) answers questions about the synthetic demo data from
the app's own records. It is **read-only**: it cannot create plans, record
counts, change inventory or the formula, and it never runs SQL written by
the model.

**Set up the key (optional).** Create a Gemini API key in Google AI Studio
(<https://aistudio.google.com/apikey>) on the free tier, without enabling
billing. Open `apps/api/.env` in a text editor (it is git-ignored) and
fill in the line copied from the template:

```
GEMINI_API_KEY=<your key>
GEMINI_MODEL=gemini-3.5-flash-lite
```

Do not put the key in `.env.example`, a commit, a chat or a command line.
Restart `npm run dev`. The tests never contact Google: they use a simulated
Gemini and ignore these settings.

**Free tier terms.** Questions and answers go to Google, which may use them
to improve its products, and human reviewers may read them: do not type
personal or sensitive information (the page says so). Google's terms allow
only paid services for apps offered to users in the European Economic
Area, Switzerland or the United Kingdom. Rate limits are per Google Cloud
project and shown in AI Studio (<https://aistudio.google.com/rate-limit>).

**From any page.** The round Rivy button at the bottom right (Rivero's
symbol with a smile) opens the same conversation in a panel: docked at the
right on wide screens (the page narrows beside it, nothing is covered), a
drawer on tablets and a nearly full-screen sheet on phones. If the button
is in the way, drag it aside with a finger or the mouse: a tap or a click
opens the chat, a drag only moves it, and it stays on screen above the
bottom bar. It keeps its place while you navigate; **Put the button back**
(house icon, in the panel) returns it to its corner. Esc or ✕ closes
it; ⤢ opens the full page. The conversation is kept while you move between
pages. The button is hidden on the Rivy page and while a count is being
entered (Rivy stays in the navigation). A dot on the button means an answer
arrived while the panel was closed. While Rivy waits for Gemini, the rest
of the app keeps working: Create plan, Recompute and counts are not held
back.

**Use.** Open **Rivy** and pick a suggested question or type one (up to
500 characters; Enter sends, Shift + Enter adds a line). For example:

- *Why does bin B-02-03 have its priority?* — the current score, its score
  time and the points of each factor.
- *Compare A-02-01 and B-01-05: which one comes first, and why?* — the
  order used by plans (D-011), the rule that decided it, and, apart from
  priority, whether each bin can enter a new plan.
- *What were the results of the counts of B-02-03?* — each task with the
  score at selection, its status and the count (lines, variances,
  unexpected pallets). A bin without counts has an unknown result, not
  PASS.
- *Which bins have the highest scores?* — the dashboard's Top 5 in the
  plan order, with each score and score time.
- *How is the risk score calculated?* — a short, versioned summary of the
  rules.

Rivy answers in the language of the question (English when unclear) and
keeps codes, SKUs, units and statuses as stored. Under each answer: links
to the pages it read, the time of the data ("Data as of", UTC), the tools
it read, the Gemini calls, tokens and seconds. A question may take 15–30 s
on the free tier.

**Limits.** Per question: 2 Gemini calls, 2 tool reads, 800 output tokens
per call, 30 s per call and 60 s in total. Rivy sends at most 15 requests
per minute (`GEMINI_RPM`; each question uses 2). The conversation lives
only in the page: the last six exchanges are sent with each question (you
can keep asking), **Clear conversation** starts again and reloading loses
it. Rivy does not retry by itself: after a failure, **Try again**. If
Gemini is unavailable, the quota is reached or the key is missing, the
page says so and the rest of the app keeps working.

**Checked answers.** Under each answer, **Records read** shows, from the
API, the data Rivy used: scores with band and score time, factors,
comparisons, the Top 5, tasks and count lines. Before the text is shown, the
API checks that every bin code, pallet code, SKU, link, date, time and
number in it comes from those records (not from the question or earlier
answers), and that a figure written next to a bin is that bin's. If not,
the text is replaced by a note naming what did not match; the records are
still shown, and **Try again** asks again. Questions the records cannot
answer (for example, the lowest scores) get "the records do not show it".
The check is a filter of codes, links, dates, times and numbers, not proof
that the explanation is right: a text can pass it and still describe the
records wrongly, so **Records read** is the reference.

## Interface

The look follows Rivero's identity (decision D-013): the Rivero logo, the
Onest typeface, brand blue and black, light and dark themes. In the light
theme the top bar, the overview band and the phone tab bar are white, with
a version of the logo with dark letters; in the dark theme they are black
(D-018, adjustments of 2026-10-21). Onest is
stored in the repository (`apps/web/app/fonts/`, SIL Open Font License), so
the build needs no network and the browser loads no external font. A
"Prototype" notice in the top bar names the demo scenario loaded (D-017).

**Motion and states (decision D-018).** A page's main blocks enter one
after another (at most 0.2 s apart in total), the link followed shows a
thin bar while the next page loads, and the theme switch cross-fades. While
Rivy reads the records its avatar pulses; a new answer, already checked, is
revealed block by block. **Create plan** and
**Recompute scores** show that they are working, then a check with the
server's own result (for example "25 of 30 tasks created" when 5 bins
already have a pending task), or an error: **Retry** when nothing was sent;
"not confirmed" with a link to Tasks when the outcome is unknown (no answer,
a server or gateway error after the request, or an answer that cannot be
read: the plan may exist). A count whose result is unknown keeps the
quantities as sent and offers to send that same count again, which is safe
(D-012). Nothing waits on purpose; with the system's "reduce motion"
setting there is no animation. Buttons keep the keyboard focus while
working.

The 3D heatmap (decision D-015) uses Three.js (`three` 0.186.1, exact
version), downloaded only when the 3D view is chosen: the dashboard's
initial JavaScript grows by about 5 KB.

## Known limitations

- The high-risk scenario's spread (8 / 12 / 10) holds at its reference
  time: a later **Recompute scores** or a count moves the 30-day window and
  changes it (see [Demo data](#demo-data)).
- Rivy depends on Gemini's free tier: answers can be slow, Gemini may be
  busy (503) and the quota is per project (429). The check covers codes,
  links, dates, times and numbers, not wording: a sentence can still
  misread a figure that is in the records (the **Records read** table is
  the reference), and a number written in words is not checked. A correct
  text that derives a new number (a difference, a sum) or repeats a value
  only the question gave is replaced. The conversation is not saved.
- The data is synthetic, and the last audit dates before the first count
  are simulated (see [Demo data](#demo-data)).
- Audit insights describe the counts saved in the last 30 days, nothing
  more: the observed FAIL proportion is not the warehouse's error rate
  (bins are chosen by priority and a bin can be counted more than once),
  the simulated audit dates are not counts, and the period cannot be
  changed.
- The 3D view was checked in Chromium (desktop and phone emulation) with
  software WebGL; other browsers and real phones were not tested here. It
  needs WebGL; without it the 2D heatmap is shown.
- There is no way to record movements from the app: movements only come
  from the demo generator, so the "inventory changed" path of the count is
  exercised by the tests rather than by normal use.
- A FAIL does not correct the inventory (decision D-004): a later count of
  that bin fails again if the discrepancy is still there (it passes if the
  quantities then match), and the app has no reconciliation workflow.
- Weights and caps are initial heuristics, not calibrated with real count
  results.
- With an old `SEED_NOW`, a recompute (button or count) moves every score to
  the current time and the 30-day window past the demo activity.
- Counts take turns, because each one recomputes every bin: fine for this
  warehouse, not for a large one.
- Rejected and conflicting submissions are not stored; reloading the count
  page after a count shows "no pending task".
- No camera scanning, no user accounts or authentication.
- `npm run build` while `npm run dev` runs replaces the API's `dist/` folder
  and stops the development API: stop `dev` first.

## Other commands

| Command | What it does |
|---|---|
| `npm test` | API tests against a separate PostgreSQL test database (`smart_cycle_count_test`, created and migrated automatically; the tests replace its data), including Rivy's against a simulated Gemini (no request to Google),
then the web tests (`node --test`: the 3D heatmap geometry, how the API client classifies answers to a write, and tap or drag for Rivy's button, no database). Needs `npm run db:up`. Two messages in its output are expected: a `[Nest] ERROR … simulated failure while recomputing` log (a rollback test) and one `pg` DeprecationWarning, provoked on purpose by the self-test of the queued-query check. |
| `npm run db:reset-demo-high-risk` | Replaces the demo data with the high-risk scenario (deletes the same data as `db:reset-demo`) |
| `npm run build` | Type-checks and builds the API and the web app. Stop `npm run dev` first (see [Known limitations](#known-limitations)) |
| `npm run db:down` | Stops PostgreSQL (data is kept in a Docker volume) |
| `docker compose down -v` | Stops PostgreSQL and **deletes** its data |

## Updating an existing database

`npm run db:migrate` applies only the migrations a database does not have
yet. What each step does to data that already exists:

| Coming from | What `npm run db:migrate` does |
|---|---|
| Milestone 1 | Removes the sample bin `SAMPLE-BIN-01`. If the database contains any other bin, the migration stops without changing anything |
| Milestone 2 | Adds the scores table. Bins have no score until you press **Recompute scores** or run `npm run db:reset-demo` |
| Milestone 3 | Adds the plan and task tables; bins and scores are kept |
| Milestone 4 | Adds the count tables; bins, scores, plans and tasks are kept. Stored scores stay formula version 1 until the next recompute; task copies keep the version they were made with |
| Milestone 5 / 6 (before the demo scenarios) | Adds the `demo_dataset` table, empty; nothing else changes. The top bar shows "Scenario not recorded" until the next `db:reset-demo` or `db:reset-demo-high-risk` |

## How the pieces fit

```
PostgreSQL (Docker)  ←  Prisma client  ←  NestJS API :3001               ←  Next.js server :3000  ←  browser
bins, products,          PrismaService      GET /warehouse                    / (grid, recompute, create plan)
pallets, movements,                         GET /bins/:code                   /bins/[code] (detail)
bin_scores,                                 POST /scores/recompute            /tasks (audit tasks)
                                            GET /scores/top
                                            GET /insights/audits
audit_plans,                                POST /audit-plans                 /count (count a bin)
audit_tasks, counts,                        GET /audit-tasks
count_lines,                                GET /bins/:code/count-sheet
count_unexpected_pallets                    POST /audit-tasks/:taskId/count
                                            POST /assistant/ask  → Gemini     /rivy (Rivy)
```

- `apps/api` owns the database: the Prisma schema, migrations, the movement
  function (`src/inventory/movements.ts`), the score formula
  (`src/scoring/formula.ts`, the only implementation), the demo data
  generator (`src/demo-data/`), plan creation (`src/planning/`) and the
  count (`src/counting/`) live there, and it is the only app that connects
  to PostgreSQL. Rivy's read tools and the Gemini client are in
  `src/assistant/`; the key never leaves the API.
- `apps/web` asks the API for data from the Next.js server; the browser
  never calls the API or sees its URL (`API_BASE_URL`).

## API

| Method and path | Response |
|---|---|
| `GET /warehouse` | `200` with aisles → racks → bins (in location order), each bin with `code`, `position`, `palletCount`, `lastAuditedAt` and `score` (`value`, `priority`, `label`, `reference`, or `null` if not scored) |
| `GET /bins/:code` | `200` with the bin's location, `inventoryVersion`, `lastAuditedAt`, its current pallets (code, quantity, product SKU, name and unit) and `score` with its `breakdown`, or `404`. The code is normalised: ` a-01-03 ` finds `A-01-03` |
| `GET /scores/top` | `200` with the five highest stored scores of **all** bins (pending tasks included), in the plan order of D-011 (score, then never audited and oldest audit as stored in the breakdown, then code); each with `rank`, `binCode` and `score` with its `breakdown`. An empty list if no bin is scored. Used by the dashboard chart |
| `GET /insights/audits` | `200` with the audit insights of D-019: `reference` (T, the server time of the request) and `period` (`days` 30, `start` excluded, `end` = T included); `scopes`, the whole warehouse (`aisle: null`) then each aisle, each with `bins`, `coverage` and `failProportion` (`numerator`, `denominator`, `percent`, `null` when the denominator is 0), `counts` (`total`, `pass`, `fail`) and `latestResults` (`pass`, `fail`, `none`: each bin once, by its latest count in the period); and `bins`, every bin in location order with its `counts` in the period and `latest` (`result`, `countedAt`, or `null`). Read only |
| `POST /scores/recompute` | `200` with the reference time, the number of bins scored and how many fall in each priority band. All scores or none are saved |
| `POST /audit-plans` with JSON `{"n": 5}` (`n` optional, default 5) | `201` with the plan (`requestedCount`, `createdCount`, `excluded.pendingTask`, `excluded.noScore`) and its tasks (rank, bin code, copied score). `400` `INVALID_N` for an `n` that is not a whole number from 1 to 30; `409` `NO_SCORES` or `NO_AVAILABLE_BINS` when no plan can be created. The plan and its tasks are saved together or not at all |
| `GET /audit-tasks` | `200` with every task, newest plan first and by rank, each with its plan summary, bin code, status, the score copied at selection (with `computedAt` and `formulaVersion`) and its `count` (`result`, `countedAt`, or `null`) |
| `GET /bins/:code/count-sheet` | `200` with the bin's pending task, `inventoryVersion`, expected lines (pallet code, product, expected quantity) and the product catalog, read in one snapshot. `404` `BIN_NOT_FOUND`; `409` `NO_PENDING_TASK` |
| `POST /audit-tasks/:taskId/count` with JSON `{"inventoryVersion": 46, "lines": [{"palletCode": "P-0026", "countedQuantity": 33}], "unexpected": [{"code": "X-1", "quantity": 12, "productSku": null}]}` | `201` with the count (result, lines with expected, counted and variance, unexpected pallets) and the bin's new score; `200` with `recovered: true` and the stored count for an identical retry. `400` (`INVALID_COUNT`, `LINES_MISMATCH`, `UNEXPECTED_IS_EXPECTED`, `UNKNOWN_PRODUCT`); `404` `TASK_NOT_FOUND`; `409` `INVENTORY_CHANGED` (nothing saved; with the current version, lines and `changes`) or `TASK_ALREADY_COUNTED` (with the stored count) |
| `POST /assistant/ask` with JSON `{"question": "Why does bin B-02-03 have its priority?", "history": [{"question": "…", "answer": "…"}]}` (`history`: at most the last 6 exchanges) | `200` with `answer`, `facts` (the records read, structured: `bin`, `missing`, `compare`, `top`, `history`, `rules`), `withheld` (`null`, or what the model's text stated without support; `answer` is then a note), `references` (label and path of the pages read), `queriedAt`, `tools` (name and arguments), `model`, `usage` (Gemini calls and tokens), `ms` and `truncated`. Errors have `code`, `message`, `retryable` and, for the local rate guard, `retryAfterSeconds`: `400` `INVALID_QUESTION`; `429` `RATE_LIMITED` or `QUOTA`; `503` `NOT_CONFIGURED` or `UNAVAILABLE`; `504` `TIMEOUT`; `502` `AUTH`, `BLOCKED`, `MODEL_ERROR`, `LIMIT` or `UNSUPPORTED` (the text named codes, links, dates, times or numbers that this question's records do not contain, and no record was read). Read-only |

## Project documents

| File | Contents |
|---|---|
| [`DECISIONS.md`](DECISIONS.md) | Product and technical decisions, with their status (accepted, proposed, deferred) |
| [`PROGRESS.md`](PROGRESS.md) | What is implemented, per milestone |
| [`VERIFICATION.md`](VERIFICATION.md) | Commands actually executed, per environment, and their results |
| [`HANDOFF.md`](HANDOFF.md) | Historical snapshot of the project state on 2026-10-17 |
| [`docs/browser-checks/`](docs/browser-checks/README.md) | Browser regression scripts kept from the verification (not part of `npm test`; need Playwright) |
