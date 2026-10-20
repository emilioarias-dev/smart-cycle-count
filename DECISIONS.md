# Decision Log — Smart Cycle Count Scoring

This file records the product and technical decisions taken where the brief
(`Technical_Test.pdf`) is silent or ambiguous. Each entry states what was
decided, why, what it guarantees and what it does not.

Status values: **Accepted** (agreed, to be implemented), **Proposed** (under
discussion), **Deferred** (to be decided at a later milestone),
**Superseded**.

Last updated: 2026-10-18 (E-001 re-confirmed; E-002 pin and E-004 to E-009
accepted by the author; D-006 to D-009 accepted for milestone 2; D-010 for
milestone 3; E-004 and E-009 table statuses brought up to date; D-011 and
the D-009 reset scope for plans accepted for milestone 4; 2026-10-19: D-012,
D-010 formula v2 and the D-009 reset scope for counts accepted for
milestone 5; 2026-10-20: D-013 to D-016). Milestone 1
implements E-002 to E-008; see `PROGRESS.md` for what milestone 2
implements. "Claude's Linux workspace"
below means the claude.ai session's cloud workspace where these decisions were
taken, not the Claude Code environment that continues the work (see
`HANDOFF.md`).

This file records **decisions** only. What is built is tracked in
`PROGRESS.md`; commands actually executed and their results are logged in
`VERIFICATION.md` (from 2026-10-18; earlier checks are in `HANDOFF.md` §7 and
in the dated tables kept below).

| ID | Decision | Status |
|---|---|---|
| D-001 | Expected inventory is the one shown when the count is opened, guarded by a bin inventory version | Accepted |
| D-002 | Audit tasks keep the score and breakdown that justified their selection | Accepted |
| D-003 | Count unit and PASS/FAIL rule | Accepted |
| D-004 | A count records discrepancies; it never adjusts inventory | Accepted |
| D-005 | Only the latest score per bin is stored | Accepted |
| D-006 | Warehouse layout and bin codes | Accepted |
| D-007 | Products, pallets and locations | Accepted |
| D-008 | Movements and the movement function | Accepted |
| D-009 | Demo data: generation, reset and simulated audit history | Accepted |
| D-010 | Risk score: factors, caps, window and stored breakdown | Accepted |
| D-011 | Audit plans (Top N) and tasks | Accepted |
| D-012 | Count flow: access, unexpected pallets, retries, conflicts and results | Accepted |
| D-013 | Visual direction: Rivero identity and dashboard additions | Accepted; implemented (PR #7, merged as `d8150d3`) |
| D-014 | Next extensions: 3D heatmap, Rivy, data analysis | Accepted as direction; 3D (D-015) and Rivy (D-016) implemented, data analysis not started |
| D-015 | 3D heatmap: view, scale, camera and interaction | Accepted; implemented (PR #8, merged as `53628f1`) |
| D-016 | Rivy: read-only assistant on Gemini | Accepted; implemented on `m6-rivy`, not merged yet |
| E-001 | Develop on Linux, reproduce on Windows | Accepted; re-confirmed for Claude Code |
| E-002 | PostgreSQL 16 in Docker, pinned image, Compose in both environments | Accepted |
| E-003 | npm workspaces, one root lockfile, `npm ci` | Accepted |
| E-004 | Runtime and dependency versions | Accepted; validated in both environments |
| E-005 | API module system: ESM with Vitest | Accepted |
| E-006 | Enforcing Node and npm versions | Accepted |
| E-007 | Environment variables | Accepted |
| E-008 | Cross-platform scripts and files | Accepted with adjustments |
| E-009 | Repository workflow and push | Accepted; push demonstrated |

---

## D-001 — Reference point for expected inventory during a count

**Status:** Accepted (2026-10-17)

### Context

A count compares what the operator physically counted with what the system
expected to be in the bin. Inventory keeps changing (putaway, pick, move,
adjustment), so the comparison is only fair if the expected values and the
physical observation refer to the same moment. Three reference points were
considered:

| Reference | Failure mode |
|---|---|
| When the audit plan is created | Every legitimate movement between plan creation and the count shows up as a false discrepancy. Widest window (hours). |
| When the operator opens the count | Smallest window, but a movement that happens while the operator is counting can still produce a false result. |
| When the count is submitted | Compares a physical observation with a record that may be newer than what was counted. |

Worked example (bin `A1-R1-B03`, pallet `P-101`, no real error in the bin):
plan at 08:00 (system 40) → legitimate pick of 5 at 09:15 (system 35) →
operator opens at 10:00 and counts 35 at 10:05 → legitimate pick of 10 at
10:08 (system 25) → submit at 10:12 with 35. Plan-time reference gives a false
FAIL (−5); submit-time reference gives a false FAIL (+10); open-time reference
gives PASS, but only because the operator counted before the 10:08 pick.
(Identifiers such as `A1-R1-B03` and `P-101` are illustrative; the bin code
format is deferred.)

### Decision

The reference is **the inventory shown to the operator when the count is
opened**. Its values are **copied into the count record at submission**, and
only if the bin's inventory has not changed in between.

- Each bin has an integer `inventoryVersion`. Every movement that touches a
  bin (as source or destination) increments it in the same database
  transaction as the movement. A count never changes inventory (D-004), so it
  never changes the version.
- Opening a count returns the expected lines (pallet, product, quantity) and
  the bin's current `inventoryVersion`.
- Submitting a count sends the counted lines, any unexpected pallets (D-003)
  and the `inventoryVersion` that was shown.
- The server, inside one transaction, locks the bin row
  (`SELECT … FOR UPDATE`) and compares versions:
  - **Same version:** the current inventory is exactly what the operator saw.
    The expected values are copied into the count lines next to the counted
    values, variances and PASS/FAIL are computed (D-003), the task is marked
    `DONE`, and a score recompute is triggered.
  - **Different version:** the server responds `409 Conflict` with the current
    version and the current expected lines, marking which lines changed. No
    count is recorded, the task **stays `PENDING`**, and the score is not
    touched.
- On conflict, the client keeps the quantities the operator entered,
  highlights the affected lines, and requires the operator to review or
  recount them. The client **never resubmits automatically**: the new version
  is attached only to a submission the operator explicitly confirms after
  reviewing the affected lines.

Why a version number instead of comparing pallets or quantities: comparing
pallet IDs misses quantity changes on the same pallets, and comparing
quantities misses a pick and putaway that cancel out. Any recorded movement
changes the version.

### Concurrency protection

Movements and count submissions both take the lock on the same bin row, so
the version check and the count write cannot interleave with a movement:

- If a movement commits first, the submission waits for the lock, then reads
  the new version and returns `409`.
- If the submission holds the lock first, the movement waits; the count is
  recorded against the pre-movement inventory, and the movement then
  increments the version.

All inventory changes (seed, tests and any future endpoint) go through a
single movement function, so the version is always kept in step with the
inventory.

### Required verification

1. **Movement between open and submit:** open (version N) → apply a movement
   → submit with N → expect `409`, task still `PENDING`, no count row, bin at
   version N+1, score unchanged.
2. **Movement during save, movement first:** a movement transaction holds the
   bin lock while a submission with version N starts → the submission blocks,
   then returns `409` after the movement commits.
3. **Movement during save, submission first:** a submission with version N
   holds the bin lock while a movement starts → the movement blocks; the count
   is stored with the pre-movement expected values; the bin ends at version
   N+1.
4. In every case, at most one count is recorded per task.

### What this guarantees

- PASS/FAIL compares the counted quantities with exactly what the operator
  saw.
- No recorded movement between opening and submitting goes unnoticed,
  including one that races with the save.
- Count history stays interpretable after inventory changes, because the
  expected values are stored with each count.
- The behaviour is deterministic and covered by regression tests.

### What this does not guarantee (known limitations)

- **Unrecorded physical movements** during a count are not detected; they
  appear as discrepancies, indistinguishable from real errors.
- **Late recording:** a movement done physically before submission but
  recorded afterwards produces a false FAIL.
- **No bin freeze:** movements are not blocked while someone counts, so a
  busy bin may require repeated recounts.
- **Coarse granularity:** a change to any pallet in the bin invalidates the
  whole submission, even if other lines were unaffected.
- **Late detection:** the operator learns about the change on submit, not
  while counting.
- **No per-line count time:** the system does not know when each pallet was
  physically counted.
- **Rejected submissions are not stored** in the MVP, so conflict frequency is
  not measured.
- **Demo visibility:** the MVP has no live movement source (movements come
  from the seed), so the conflict path is exercised by the tests rather than
  by normal use.

Production-grade alternatives, out of MVP scope: freezing the bin for the
duration of the count, timestamping each counted line, and scheduling counts
in low-activity windows.

---

## D-002 — Audit tasks keep the score that justified their selection

**Status:** Accepted (2026-10-17)

### Decision

When an audit plan is created, each task stores a **copy** of the score, the
factor breakdown and the computation timestamp that placed its bin in the
Top N.

### Why

"Why is this bin in the plan?" and "what was in the bin when it was counted?"
are different questions. The first must stay answerable after the score is
recomputed. The plan stores the selection rationale, not an inventory
snapshot; the inventory snapshot belongs to the count (D-001).

A copy is required (rather than a reference) because only the latest score
per bin is stored (D-005): the row that justified the selection is
overwritten by the next recompute.

---

## D-003 — Count unit and PASS/FAIL rule

**Status:** Accepted (2026-10-17)

### Decision

- **One SKU per pallet.** Each pallet holds a single product and an integer
  quantity of units.
- **Count unit:** the operator enters the number of units counted for **each
  expected pallet** in the bin. Quantities are non-negative integers. Every
  expected pallet must receive a value; a pallet that is not found is entered
  as `0`.
- **Unexpected pallets:** the operator can flag pallets found in the bin that
  the system did not expect.
- **PASS** if and only if every expected pallet's counted quantity equals its
  expected quantity (tolerance `0`) **and** no unexpected pallet was flagged.
  Otherwise **FAIL**.
- The system derives the result; the operator does not choose it.
- Each count line stores expected quantity, counted quantity and variance
  (`counted − expected`).

### Why

Counting per pallet makes a discrepancy locatable (which pallet, how many
units) instead of only "the bin is off". Deriving the result from stored
numbers makes it reproducible and auditable, and removes operator judgement
from the outcome. An unexpected pallet means the system's view of the bin is
wrong even when all expected quantities match, so it cannot be a PASS.

### Limitations

- Zero tolerance treats every unit difference as a failure; there is no
  threshold for low-value or high-volume items.
- Mixed-SKU pallets are not modelled.
- The information captured for an unexpected pallet is defined in D-012;
  it records a discrepancy only and does not create inventory (D-004).

---

## D-004 — A count records discrepancies; it never adjusts inventory

**Status:** Accepted (2026-10-17)

### Decision

A FAIL records the discrepancy (lines, variances, unexpected pallets) and
feeds the scoring. It does not create adjustments or change pallet
quantities or locations.

### Why

Counting and reconciling are separate steps in warehouse operations; an
automatic correction would hide the error behind a silent change and make the
audit trail harder to read. It also keeps D-001 simple: a count never changes
the bin's inventory version.

### Limitations

- After a FAIL, the system keeps expecting the recorded quantities until
  someone adjusts them, so a recount of the same bin will fail again for the
  same reason.
- The MVP has no reconciliation workflow.

---

## D-005 — Only the latest score per bin is stored

**Status:** Accepted (2026-10-17)

### Decision

Each bin has one current score record (score, factor breakdown, computation
timestamp), overwritten on every recompute.

### Why

The brief requires the current score and its explanation; the selection
rationale needed later is preserved by D-002 and the counts preserve what was
observed. Keeping one row per bin keeps the model and queries simple.

### Limitations

- No score trend per bin and no "before/after recompute" comparison from
  stored data.
- Evaluating the scoring retrospectively would rely on task copies (D-002)
  and counts, not on a full score history. To be revisited if an optional
  improvement needs history.

---

## D-006 — Warehouse layout and bin codes

**Status:** Accepted (2026-10-18). Milestone 2.

- **Layout:** 3 aisles (`A`, `B`, `C`) × 2 racks × 5 positions = 30 bins, a
  single level. Aisles and racks have no data of their own, so they are
  columns of the bin (`aisle`, `rack`, `position`) rather than tables;
  separate tables can be introduced by a later migration if they gain
  attributes.
- **Code:** `A-01-03` = aisle `A`, rack 1, position 3. `rack` and `position`
  are stored as integers; the leading zeros belong to the code format only.
  The code is derived from the location when the bin is created.
- **Uniqueness:** both the code and the location (`aisle`, `rack`,
  `position`) are unique. PostgreSQL also checks that the code matches the
  location.
- **Ordering:** lists and the grid are ordered by the location fields
  (`aisle`, `rack`, `position`), not by the code text.
- **Search:** a code typed or scanned by a user is normalised before the
  lookup: whitespace removed, letters upper-cased (` a-01-03 ` → `A-01-03`).

Limitations: one level per rack; no capacity per bin (see D-007).

## D-007 — Products, pallets and locations

**Status:** Accepted (2026-10-18). Milestone 2.

- **Product:** unique `sku`, `name` and `unit`. The unit says what one
  counted unit is (for example `case` for "Bottled water 24 × 500 ml"); all
  quantities of that SKU are in that unit, with no conversions.
- **Pallet:** unique `code` (its licence plate, `P-0001`), exactly one
  product (D-003), an integer `quantity` and an optional bin.
- **Location rule:** a pallet with a positive quantity is always in a bin. A
  pallet whose quantity reaches zero has no bin and is kept for history. A
  depleted pallet is never reused: a new arrival creates a new pallet.
  PostgreSQL enforces `quantity >= 0` and "positive ⇔ located".
- A bin can hold several pallets, of different products. No capacity rule
  is enforced (limitation); the demo data keeps at most 4 pallets per bin.
- **Bin fields added:** `inventoryVersion` (D-001) and `lastAuditedAt`
  (D-009).

## D-008 — Movements and the movement function

**Status:** Accepted (2026-10-18). Milestone 2.

| Type | Rule | Pallet effect | Logged from → to | Quantity change |
|---|---|---|---|---|
| `PUTAWAY` | Creates a **new** pallet with a positive quantity in a bin | New pallet, located | — → bin | `+q` |
| `PICK` | Removes `q > 0` units, never more than available | `quantity − q`; at zero it leaves its bin | bin → — | `−q` |
| `MOVE` | Moves the whole pallet to a **different** bin; quantity unchanged | Bin changes | source → destination | `0` |
| `ADJUSTMENT` | Applies a non-zero delta; the result cannot be negative | `quantity + delta`; at zero it leaves its bin | bin → bin | `delta` |

- For adjustments, "from" and "to" are the same bin as a **logging
  convention**: it records where the adjustment happened and does not mean a
  depleted pallet stays located.
- **One function** (`applyMovement`) performs every inventory change (D-001),
  including the seed. In one transaction it locks the affected bins
  (`SELECT … FOR UPDATE`, in id order), then locks and re-reads the pallet,
  **validates the current state after acquiring the locks**, updates the
  pallet, records the movement and increments `inventoryVersion` **once per
  affected bin** (a bin that is both "from" and "to" counts once). Any
  failure rolls everything back.
- PostgreSQL also enforces the shape of each movement type (which bins are
  set, sign of the quantity change, different bins for a move), the
  relations (no cascading deletes) and uniqueness.
- The movement log keeps enough data and order (the movement id is the
  application order) to rebuild every pallet's quantity and location, and
  every bin's version.
- Not included: splitting a pallet, multi-pallet operations, creating
  movements through the API.

## D-009 — Demo data: generation, reset and simulated audit history

**Status:** Accepted (2026-10-18). Milestone 2.

**Reproducibility**

- A seeded pseudo-random generator (implemented in the project, no new
  dependency). Same **generator version**, **seed** and **reference time**
  ⇒ the same business data (codes, quantities, locations, dates, movement
  order). Internal ids are not part of that promise.
- The reference time is captured **once** per run: `SEED_NOW` if set, which
  must carry an explicit zone (`2026-10-18T12:00:00Z` or `…-04:00`), else the
  current time. All dates are stored in UTC.
- Timeline: opening stock (putaways) between 60 and 30 days before the
  reference; then 30 days of activity (putaways, picks, moves, adjustments)
  up to, and never after, the reference. Movements are applied in
  chronological order with a stable tie-break.
- Activity is deliberately uneven (busy, normal and quiet bins; a few bins
  prone to adjustments; some empty bins). Totals are whatever the
  simulation produces; no artificial events are added to reach a number.
- `lastAuditedAt` is a **simulated antecedent**: about a third of the bins
  were never audited, the rest between 2 and 90 days before the reference.
  There are no audit records or results behind it; the absence of results
  must not be read as a PASS.

**Reset**

- Loading demo data **replaces** the bins, products, pallets and movements
  (all of them are deleted and rebuilt). It only runs with explicit
  authorisation (`--confirm-reset` argument, provided by the
  `npm run db:reset-demo` script), only against a dedicated project database
  (name `smart_cycle_count` or `smart_cycle_count_<suffix>`), prints the
  target without the password, and is never run automatically on start.
- Deletion and rebuild happen in **one transaction**: if anything fails,
  the previous data stays as it was.
- Tables are cleared without `CASCADE`.
- **Plans and tasks (accepted 2026-10-19, milestone 4):** the explicit reset
  also deletes audit plans and tasks, naming those tables, reporting how
  many it deletes and staying in the same transaction. Their historical
  selection explanations (D-002 copies) are lost with them.
- **Counts (accepted 2026-10-19, milestone 5):** the explicit reset also
  deletes counts, their lines and unexpected pallets, naming those tables,
  reporting how many counts (with how many PASS and FAIL), lines and
  unexpected pallets it deletes, in the same transaction and with the same
  protections. The PASS/FAIL history is lost with them.
- The milestone 2 migration deletes the milestone 1 sample bin
  (`SAMPLE-BIN-01`) and nothing else; if any other bin exists, the
  migration stops with an error instead of deleting it. Earlier migrations
  are kept unchanged.

---

## D-016 — Rivy: read-only assistant on Gemini

**Status:** Accepted (2026-10-20); implemented on branch `m6-rivy` (D-014's
second extension). No migration, rule, formula or data change; Rivy only
reads. The data analysis follows in its own branch.

- **What Rivy does:** answers four kinds of questions about the synthetic
  demo data: why a bin has its priority (stored score and breakdown);
  which of two bins comes first and why (the D-011 order); the tasks and
  counts of a bin (results and discrepancies); and the app's rules. The
  page is `/rivy`; its interface and suggested questions are in English.
  Rivy answers in the language of the question (English when unclear) and
  keeps codes, SKUs, units and statuses (`PASS`, `FAIL`, `PENDING`, `DONE`,
  High / Medium / Low) as stored.
- **Read-only by construction:** the model can only ask for five read
  tools; the API runs them with fixed Prisma reads. There is no tool that
  writes, no SQL generated by the model, and an unknown tool name gets
  "Rivy is read-only". Plans, tasks, counts, inventory and the formula are
  never changed by Rivy.

  | Tool | Returns |
  |---|---|
  | `get_bin` | The stored current score (value, band, score time, formula version, each factor with weight, input, cap and points), the last audit, the pallets and any pending task, with the query time apart from the score time |
  | `compare_bins` | Both bins' current scores, which one comes first and the rule that decided it (`comparePriority` of D-011, the same code as plans), and, apart from priority, whether each is available for a new plan (a pending task excludes it) |
  | `get_top_bins` | The dashboard's Top 5 (`GET /scores/top`): the five highest current scores of all bins, in the D-011 order, each with its band and score time. Added on 2026-10-20 after the author's Windows run (below); no other ranking exists |
  | `get_bin_history` | The last 5 tasks of the bin with the score copied at selection (D-002) apart from the current score, the status and the stored count (result, lines with expected, counted and variance, unexpected pallets). No task means "unknown, not PASS". Scores that are not stored (D-005) are not rebuilt |
  | `get_rules` | A short summary of the approved rules, versioned (`2026-10-20 (score formula v2)`) |

- **Figures and links come from the API, and the API checks the answer:**
  every figure is in a tool result; the instructions tell the model to use
  only those, to give times in UTC and to treat earlier answers as possibly
  outdated (it asks the tools again). Instructions alone are not relied on:
  before an answer is returned, the API looks up every bin, pallet and SKU
  code, link path, date, time and number in it (written forms accepted:
  rounding to the shown decimals, a decimal comma, "22:38 UTC", whole
  numbers up to 10) among **this question's tool results and the question
  itself**; earlier answers are not a source. If anything is missing, the
  answer is not shown: the page says what it mentioned that the records read
  do not contain (`UNSUPPORTED`, retryable), and the API logs it. A bin's
  page is listed as a source only if the answer names that bin; "Data as
  of" is the query time of the API. When no tool returns what a question
  needs, the expected answer says the records do not show it.

  *Why (2026-10-20, author's Windows run with the real model):* asked
  "que bins tienen la mayor puntuacion", with no ranking tool, the model
  read `compare_bins` for two bins of the conversation and wrote two other
  bins with scores 71 and 70, plus a "data as of" time that no tool had
  returned (the text said 23:14:45, the query was at 23:10). The rules
  answer also carried an invented time.
- **Model:** `gemini-3.5-flash-lite` (stable, function calling, minimal
  thinking by default, free tier), set by `GEMINI_MODEL`, with **no
  automatic switch** to another model. Gemini 3.8 Flash was considered
  and answered 503 (high demand) to the three requests made here.
- **Integration:** the REST endpoint `models/{model}:generateContent` with
  Node's `fetch` in the API, no SDK (no new dependency). The model's turn
  is sent back exactly as received, so thought signatures are kept. The
  key stays on the API server (`GEMINI_API_KEY` in `apps/api/.env`); the
  browser talks only to the Next.js server, as for every page.
- **Limits per question:** at most 2 Gemini calls (the first may ask for
  tools; the second may not) and 2 tool runs; 500 characters per question;
  800 output tokens per call; 30 s per call and 60 s per question. A local
  guard keeps Rivy under `GEMINI_RPM` (default 15) requests per minute.
  No automatic retries: a failed question offers **Try again**.
- **Errors:** each failure has its own status and a message for the user;
  the rest of the app keeps working. 400 invalid question; 429 local rate
  guard or Gemini quota; 503 no key ("Rivy is not configured") or Gemini
  unavailable; 504 timeout; 502 refused key, blocked question, no answer
  within the limits, or an answer withheld by the check above. Without a key no request leaves the API.
- **Conversation:** only in the page's memory (no new tables). The last six
  complete exchanges are sent with each question as text; older ones are
  dropped and noted. The number of questions is not limited. **Clear
  conversation** empties it; reloading the page loses it.
- **Data terms:** on the free tier Google uses prompts and answers to
  improve its products and human reviewers may read them; "do not submit
  sensitive, confidential, or personal information". The page says so.
  The terms allow only paid services for API clients offered to users in
  the European Economic Area, Switzerland or the United Kingdom. Billing
  is not enabled for this project; the data is synthetic.
- **Quota:** limits are per project and shown only in AI Studio. The author
  sees 15 RPM and 500 RPD for Gemini 3.5 Flash-Lite; the tokens per minute,
  the project behind the key and its tier are not confirmed yet.

---

## D-015 — 3D heatmap: view, scale, camera and interaction

**Status:** Accepted (2026-10-20); implemented on branch `m6-heatmap-3d`
(D-014's first extension; PR #8, merged as `53628f1`). Presentation only: no formula, rule or data
change. Only the 3D view is in this branch; Rivy and the data analysis
follow in their own branches.

- **Same data as the 2D heatmap:** the 30 bins of `GET /warehouse` in the
  same plan (one row per rack, aisle by aisle; one column per position),
  the same scores, bands, colors and "Scores as of", and the task
  information the 2D view uses (pending task; result in the latest plan).
  No levels, shelves or capacity are drawn: the data has none.
- **2D first:** the heatmap opens in 2D. The 3D view is a client component
  loaded only when chosen (`next/dynamic`, no server rendering). Without
  WebGL, on a lost WebGL context, a failed download or a render error, the
  2D view comes back with a notice. Leaving 3D frees geometries,
  materials, the renderer (and its context) and every listener.
- **Library:** Three.js only, `three` 0.186.1 (2026-09-24, MIT, no runtime
  dependencies) and `@types/three` 0.186.0 (development), exact versions
  in the lockfile. React Three Fiber and drei were not used: they add over
  20 packages that a fixed-orientation view does not need.
- **Scale (choice documented as asked):** short columns proportional to the
  score on one fixed linear 0–100 scale were tried first and kept: height
  = 0.14 + 1.3 × score / 100 (footprint 0.8). A score of 0 keeps the 0.14
  base (visible, selectable, in its band color); a bin without a score is
  a lower flat tile with a dashed outline; an empty bin is not a geometry
  case (its pallets are in the details). Uniform low blocks were not
  needed: with this camera, at least 91 % of every top face stays visible
  with all scores at 0, all at 100, alternating by row and by column and as
  a checkerboard (computed with three's raycaster in `node --test`); the
  same cases were checked in the browser (30 of 30 bins selected directly).
- **Camera:** orthographic, fixed orientation (60° down, turned 14°), no
  rotation. Zoom from the whole plan (1×) to 4×, around the pointer or the
  fingers. Reset frames the whole plan for the current size of the view
  (also after a resize). A band at the top of the view is kept free at
  zoom 1 for the +, − and Reset buttons, which stay in the view's corner.
- **Interaction:** a click or a tap selects and keeps the details (code,
  score, band, pallets, task or last result, link to Bin details); the bin
  list selects and marks the same bin (keyboard). A move of more than 6 px
  is a drag, not a selection. Mouse: drag pans; Ctrl + wheel (or a trackpad
  pinch) zooms; a plain wheel scrolls the page. Touch: one finger scrolls
  the page; two fingers pan and zoom. Hover shows the code and score; the
  selected bin shows them as a tag. Rows (`A-01` … `C-02`) and positions
  (`01`–`05`) are labelled at the edges of the plan, kept whole inside the
  view.
- **Left out:** markers floating over every block, decorative animations
  and free rotation.

---

## D-014 — Next extensions: 3D heatmap, Rivy, data analysis

**Status:** Accepted as direction (2026-10-20); the 3D heatmap (D-015) and
Rivy (D-016) are implemented, the data analysis is not. Each
extension gets its own branch and pull request, after the redesign, in this
order: the 3D heatmap, then Rivy, then the data analysis. The
delivery is planned for Thursday 2026-10-22. Final acceptance of the whole
(clean clones, version tag) comes after the extensions.

- **Interactive 3D heatmap**, as an alternative view of the same data: fixed
  orientation; select a bin with mouse or touch; zoom; a camera reset; and
  the 2D heatmap kept as the alternative (and for accessibility).
  Implemented as D-015.
- **Rivy**, an assistant to query the data and explain decisions: Google
  **Gemini**, **read-only** (it never creates plans, counts or movements).
  Decided and implemented as D-016.
- **Additional data analysis** by the author, afterwards.

---

## D-013 — Visual direction: Rivero identity and dashboard additions

**Status:** Accepted (2026-10-20); implemented on branch `m6-redesign`
(milestone 6), merged through PR #7 (`d8150d3`). Presentation only: no formula, rule or data changes.

- **Identity (Rivero, from riveroco.com):** the official logo file, the
  Onest typeface, brand blue `#235cf2`, black `#070707` / `#040404` and its
  neutral greys; sentence-case titles ending in a blue dot, eyebrows with a
  slash, pill buttons with an arrow, square-cornered panels. Finish taken
  as reference from viamaster-intl.com, moto-card.com and mvplogistics.eu.
- **Kept:** both themes; the priority colors, always with the number and
  the label (D-010); the existing actions.
- **Dashboard additions approved:** an overview band (priority mix of all
  bins, latest plan progress as counted / total, bins never audited), each
  with its scope and time reference; TASK / PASS / FAIL markers on the
  heatmap, visually distinct from priority; the latest plan with the score
  at selection next to the current score; a "Score breakdown · Top 5 bins"
  chart on a common 0–100 scale.
- **Interface text stays in English**; a short "prototype, synthetic data"
  notice stays visible.
- The design is reviewed as static mockups (dashboard, bin details, tasks,
  count, interaction states) before it reaches the application. The
  refined mockups (v4) were approved on 2026-10-20; the implementation
  goes on its own branch from `main`.

**Choices made when approving v4 and implementing it (2026-10-20):**

- **Count helper:** the submit bar says how many pallets still need a
  quantity (expected pallets and unexpected rows). A typed `0` is an
  answer; only an empty field is still pending. Shown on wide screens.
- **"No bin is in the high band in this snapshot."** stays on the heatmap
  when no bin is high; the formula and the data are not changed for it.
- **Top 5 chart:** the current Top 5 of **all** bins (pending tasks
  included), separate from the historical plan, in the D-011 order on the
  stored breakdowns (score; never audited, then the oldest audit; code). A
  read-only endpoint, `GET /scores/top`, applies the same comparison as the
  plans, so the web does not re-implement it. The v4 mockup had broken the
  57 tie by code (`A-02-01` before `B-01-05`); the accepted order puts
  `B-01-05`, never audited, first.
- **Tasks:** the task's status (Pending / Done, neutral) is shown apart from
  its count result (PASS / FAIL, colored).
- **Count result:** expected, counted and variance keep the product's unit.
- **Fixed bars:** the count form's submit bar and the phone tab bar never
  hide a field: focusing or scrolling to a field keeps it above them
  (`scroll-padding`).
- **Icon-only recompute (phones):** a real button named "Recompute scores",
  with a tooltip, 44 px target and the same busy state.
- **Font:** Onest is stored in the repository (latin subset, SIL Open Font
  License) and loaded with `next/font/local`, so the build needs no network.

---

## D-012 — Count flow: access, unexpected pallets, retries, conflicts and results

**Status:** Accepted (2026-10-19). Milestone 5. Builds on D-001, D-003 and
D-004, which stay as they are.

**Access (N1)**

- Only a bin with a `PENDING` task can be counted. The operator searches
  the bin code (D-006 normalisation; keyboard-wedge scanners type into the
  same field).
- A submission is bound to that **specific task**. A form opened for an
  earlier task never completes a later task of the same bin.

**Unexpected pallets (N2)**

- Each one: a **code** (required, normalised like bin codes), an observed
  **quantity** (integer ≥ 1) and an optional **product** from the catalog.
- Known product: its catalog unit is shown. Unknown product: the quantity
  is stored as "units declared, product unknown"; the catalog unit is
  recorded as not identified. No SKU or unit is invented.
- An unknown product never blocks the form. Any unexpected pallet makes the
  count FAIL (D-003), whether or not its product is known.
- Rejected: two unexpected pallets with the same code in one count; an
  unexpected code equal to a pallet expected in that bin (it is counted on
  its own line). At most 10 per count.
- These observations never create or change inventory (D-004).

**Retries and simultaneous submissions (N3)**

- One count per task, guaranteed by PostgreSQL, also under simultaneous
  submissions.
- A retry with the **same normalised content** (version, lines and
  unexpected pallets) returns the existing count, marked as **recovered**,
  with no repeated effects, even if the inventory changed afterwards.
- Different content for a task already counted is **rejected**: the answer
  shows the stored result and says that the new quantities were not saved.

**Inventory conflicts (N4)** (D-001)

- Nothing is stored. The previous attempt stays visible as a **draft**,
  with the changes since it was opened.
- Starting the updated recount gives an active form with **empty**
  quantities and no unexpected pallets: everything is entered again. Old
  quantities are never copied or resubmitted automatically; the new
  version only goes with a submission the operator makes.
- Opening a count reads the expected lines and the bin's version
  consistently (one snapshot).

**Results and scoring (N5)**

- Formula **v2** (D-010): age 30, activity 25, adjustments 20, last result
  25. The first three keep their caps (90 days, 40 movements,
  5 adjustments) and the 30-day window.
- **Last result:** the latest count up to the reference time. FAIL
  activates the factor (25 points); a later PASS deactivates it. With no
  count the result is **unknown**: it contributes 0 and is shown as
  unknown, never as PASS. No expiry for now.
- The breakdown stores the result used and its date, with the formula
  version and the inputs needed to reproduce the score.
- Any count sets `lastAuditedAt` to the server's time of the count.
- One transaction stores the count, its lines and unexpected pallets, marks
  the task `DONE`, sets the audit date and recomputes **every** bin with a
  common reference (the count's time). If anything fails, everything is
  rolled back.
- A connection failure is not presented as proof that nothing was saved:
  the operator can send the identical count again and gets the stored
  result if it had been saved.
- Task copies keep their own formula version and scores (D-002). v2 does
  not have to reproduce v1's numbers, and a FAIL does not have to exceed
  the previous score.
- Demo consequence (computed in SQL before implementing): with no counts,
  the demo with `SEED_NOW=2026-10-18T12:00:00Z` scores 0 high, 9 medium,
  21 low (`B-02-03` 68, `A-01-04` 33, `C-01-04` 14). A bin reaches the high
  band mainly through a FAIL.

**Demo reset (N6)** — see D-009: counts, their lines and unexpected pallets
are deleted explicitly and reported.

**Out of scope (N7):** camera scanning.

**Rules kept in the database vs in the transaction:** CHECK constraints
protect each row (quantities, variance = counted − expected, normalised
codes); the count's PASS/FAIL is derived from its lines and validated
inside the same transaction, without triggers.

---

## D-011 — Audit plans (Top N) and tasks

**Status:** Accepted (2026-10-19). Milestone 4.

**Selection**

- `N` is an integer from 1 to 30 (the number of bins); default 5. Any other
  value or type is rejected.
- **Eligible bins:** bins with a stored score and without a `PENDING` task.
  A score of 0 is a valid score; a bin without a score is not eligible.
- If fewer than `N` bins are eligible, the plan is created with those, keeps
  the requested `N` and reports how many tasks were created and why bins
  were excluded (pending task, no score).
- If none is eligible, **no plan** is created, with two distinct answers:
  "no bin has a score: recompute first" or "no bins are available".
- Plans use the **stored** scores (no automatic recompute) and show their
  reference time.

**Order:** score descending; then never-audited first, then the oldest
audit; then bin code alphabetically. The audit information comes from the
**stored score breakdown**, not from the bin's current `lastAuditedAt`.
Example (demo, `SEED_NOW=2026-10-18T12:00:00Z`): `B-02-03` 91, `C-01-01` 86,
then the 77 tie is broken by `B-01-05` (never audited) **before** `A-02-01`
(audited 83 days earlier), then `A-01-05` 70.

**What a task keeps (D-002):** a full copy of the score, its breakdown,
formula version, reference and computation times, its priority at
selection and its position in the plan. A later recompute does not change
that explanation.

**Concurrent requests:** plan creations are serialised by a short
transactional lock; after waiting, each request selects again from the bins
still available. PostgreSQL guarantees at most one `PENDING` task per bin
and creates a plan and its tasks atomically. Example: with eight eligible
bins and two requests for five, one gets five and the other three; a request
that finds no candidates creates no plan.

**Status:** `PENDING` on creation; `DONE` only through the count flow
(milestone 5). There is no manual closing.

---

## D-010 — Risk score: factors, caps, window and stored breakdown

**Status:** Accepted (2026-10-18). Milestone 3.

A heuristic, explainable priority for audits. The score is **not** a
probability of error; weights and caps are initial values to be revisited
with real count results.

| Factor | Weight | Input | Cap (factor = 1) |
|---|---|---|---|
| Age | 40 | Days since `lastAuditedAt` at the reference time; **never audited = maximum** | 90 days |
| Activity | 35 | `PUTAWAY`, `PICK` and `MOVE` movements in the window | 40 movements |
| Adjustments | 25 | `ADJUSTMENT` movements in the window | 5 adjustments |

- Each factor = `min(input / cap, 1)`; score =
  `40·age + 35·activity + 25·adjustments`, **rounded once at the end** to an
  integer 0–100.
- **Window:** `(reference − 30 days, reference]`, in UTC. A movement counts
  **once per affected bin** (a move counts for its source and its
  destination; an adjustment once).
- **Reference time:** after a demo reset, the reset's reference; the
  recompute button uses the current time.
- **Pallet count** is shown as context only; it is not a factor.
- **Bands:** 0–39 low priority (green), 40–69 medium (yellow), 70–100 high
  (red), always shown with the number and the label.
- **Stored per bin (D-005, latest only):** the score and a breakdown
  sufficient to reproduce it: reference time, formula version, inputs,
  weights, caps and each factor's contribution.
- PASS/FAIL history is not a factor yet; it comes with the count milestone
  (D-003, D-009: no results must not be read as PASS).

**Formula v2 (accepted 2026-10-19, milestone 5, D-012):** weights age 30,
activity 25, adjustments 20 and **last result 25** (1 if the latest count
up to the reference is FAIL; 0 if PASS or if there is no count, shown as
unknown). Caps, window, rounding and bands are unchanged. Stored scores and
task copies keep their formula version.

---

## Environment decisions

Verification labels used below:

- **Linux — executed:** run in Claude's Linux workspace, with the result shown.
- **Windows — executed:** run by the author on their Windows PC, with the output shared.
- **Pending:** not executed yet. Nothing marked pending should be read as passing.

### E-001 — Develop on Linux, reproduce on Windows

**Status:** Accepted (2026-10-17)

Development and verification happen in Claude's Linux workspace, where
commands are executed and their results reported. Each milestone is then
reproduced on the author's Windows PC by following the README. A milestone is
complete only when both environments pass its checks.

**Handoff note (2026-10-17):** implementation moves to Claude Code. The
principle stays (develop and verify in one environment, reproduce on the
author's Windows PC), but the Claude Code environment has not been
characterised yet (OS, Node/npm, PostgreSQL or Docker, network, GitHub
access). This decision must be re-confirmed for that environment before
milestone 1 starts.

**2026-10-18:** the Claude Code environment was characterised (Linux
container, Docker usable, official Node 24.22.0 installed; see
`VERIFICATION.md`).

**Re-confirmed (2026-10-18)** for the Claude Code environment: development
and verification happen in the Claude Code Linux container; the author then
reproduces **the same commit** on Windows before merging the milestone into
`main` (E-009).

### E-002 — PostgreSQL 16 in Docker

**Status:** Accepted (2026-10-17); exact image pin accepted 2026-10-18.
Docker Compose is the documented path in **both** environments.

- `docker-compose.yml` uses
  `postgres:16.15@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d`.
  That is the multi-architecture index digest of tag `16.15` (Debian trixie);
  Docker Hub lists the same digest for `16` and `16.15-trixie`, last updated
  2026-10-07, so 16.15 is the newest 16.x release.
- **Host port 5433** (container port 5432), bound to `127.0.0.1`, decided by
  the author on 2026-10-18: the author's Windows PC already runs a native
  PostgreSQL on 5432, which stays installed and untouched. Development and
  test connection strings use `localhost:5433`.
- The digest was read from the Docker Hub tags API through a web tool, not
  from a `docker pull`. The pull on Windows is the real verification: a wrong
  digest makes the pull fail.
- Claude's workspace (claude.ai) had no Docker daemon and used a native
  PostgreSQL 16.15 server. The Claude Code environment can run Docker, so the
  native fallback is no longer used.

| Check | Result |
|---|---|
| Linux — executed: native PostgreSQL 16.15 start, create DB, query over TCP, stop | OK |
| Windows — executed: Docker 29.8.2, Compose v5.6.0, engine running, `hello-world` | OK |
| Windows — executed 2026-10-18: host port 5432 | Occupied by a native PostgreSQL (`postgres`, PID 8488); port 5433 free. Led to the 5433 decision above |
| Windows — pending: pull and run the pinned image, `pg_isready`, `select version()` | — |
| Claude Code environment — executed 2026-10-18: pull by digest, `pg_isready`, `select version()` → 16.15 (details in `VERIFICATION.md`) | OK |

The exact pin was accepted by the author on 2026-10-18.

### E-003 — npm workspaces, one lockfile, `npm ci`

**Status:** Accepted (2026-10-17)

- The root `package.json` declares the workspaces `apps/api` and `apps/web`.
- A single `package-lock.json` lives at the repository root and is committed.
- Installs use `npm ci`. Direct dependencies are pinned to exact versions
  (`save-exact=true`).
- Incompatibilities are fixed by choosing versions, never hidden with
  `--force` or `--legacy-peer-deps`. Dist-tags such as `latest` are never
  used to select a version.

**Implementation note (2026-10-18):** npm 11.19.1 records which dependencies
may run install scripts in an `allowScripts` field. Unreviewed scripts still
run, with a notice. After reviewing them, the two Prisma packages that need
them (`prisma` preinstall: Node version check; `@prisma/engines` postinstall:
schema engine download) are approved with pinned entries
(`prisma@7.10.1`, `@prisma/engines@7.10.1`) in the root `package.json`.
Upgrading Prisma therefore also requires re-approving with
`npm install-scripts approve prisma @prisma/engines`.

### E-004 — Runtime and dependency versions

**Status:** Accepted (2026-10-18) as the initial selection; **validated**
through installation, compilation and execution in both environments
(milestones 1 and 2, see `VERIFICATION.md`). A version that
fails validation is replaced explicitly and recorded here. Originally proposed
2026-10-17; supersedes the earlier proposal (Node 22 minimum, TypeScript
`~6.0`).

Metadata re-checked on 2026-10-18 (see `VERIFICATION.md`): every pin exists
and is still the highest release of its line; `engines` and
`peerDependencies` unchanged. Since the proposal, `vitest`'s `latest` moved to
5.0.5; 4.1.12 is kept because the NestJS 12 ESM template targets Vitest 4.1.

| Package | Exact version | Reason / declared compatibility |
|---|---|---|
| Node.js | 24.22.0 | LTS "Krypton", released 2026-10-14. Required: `@nestjs/schematics` 12.0.7 and `@angular-devkit/*` 22.2.x declare `node ^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0`. Node 24 moves to maintenance LTS on 2026-10-20; end of life 2028-04-30. |
| npm | 11.19.1 | Bundled with Node 24.22.0 ("deps: upgrade npm to 11.19.1" in the 24.22.0 changelog). Satisfies every `engines.npm` in the tree. npm 12 exists and is not used. |
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/testing` | 12.1.3 | `@nestjs/core` engines `node >= 20`; peers `rxjs ^7.1.0`, `reflect-metadata ^0.1.12 \|\| ^0.2.0`. |
| `@nestjs/cli` | 12.0.8 | Engines `node >= 20.11`; depends on `typescript ~6.0.2` and pins `@angular-devkit/*` 22.2.0. |
| `@nestjs/schematics` | 12.0.7 | Engines `node ^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0`; peer `typescript >=6.0.0`; uses `@angular-devkit/*` 22.2.2. |
| `reflect-metadata` / `rxjs` | 0.2.2 / 7.8.2 | Peers of NestJS. |
| `prisma`, `@prisma/client`, `@prisma/adapter-pg` | 7.10.1 | Engines `node ^20.19 \|\| ^22.12 \|\| >=24.0`; peer `typescript >=5.4.0`. Pinned explicitly because npm `latest` for `prisma` is `8.0.0-rc.23`. `pg` 8.23.1 comes in through the adapter. |
| `typescript` | 6.0.3 | Latest 6.0.x. npm `latest` (7.0.2) is excluded because `@nestjs/cli` requires `~6.0.2`. |
| `next` | 16.4.2 | Engines `node >=20.9.0`; peers `react` / `react-dom ^18.2.0 \|\| ^19.0.0`. |
| `react`, `react-dom` | 19.3.1 | `react-dom` peer `react ^19.3.1`. |
| `@types/react`, `@types/react-dom` | 19.3.0 | Matching React 19.3 types. |
| `@types/node` | 24.19.2 | Latest 24.x types. |
| `vitest` / `vite` | 4.1.12 / 8.3.4 | API tests (E-005). Vitest peer `vite ^6 \|\| ^7 \|\| ^8`; Vite engines `node ^20.19.0 \|\| >=22.12.0`. |
| `supertest` / `@types/supertest` / `@types/express` | 7.3.1 / 7.2.1 / 5.0.6 | HTTP tests for the API. |
| `dotenv` | 18.0.8 | Loads `.env` (E-007). |
| `concurrently` | 10.0.6 | Runs API and web dev servers together on Windows and Linux (E-008). Engines `node >=22`. |

**Linux — executed** (Node 24.22.0, npm 11.19.1): a throwaway workspace with
exactly these pins was resolved with
`npm install --package-lock-only --ignore-scripts`.

- Exit code 0, no `ERESOLVE`; 493 packages in the tree.
- One copy each of TypeScript (6.0.3), Prisma and its client (7.10.1), React
  (19.3.1) and Next.js (16.4.2). `@angular-devkit/*` appears as 22.2.0 and
  22.2.2, because `@nestjs/cli` pins exact versions.
- `engines` check over the whole tree with Node 24.22.0: one mismatch,
  `@img/sharp-win32-ia32` (optional, 32-bit Windows only, not installed on
  x64).
- The same check with Node 24.14.0 or 22.22.0: 7 dev packages fail
  (`@nestjs/schematics` and `@angular-devkit/*`).

**Validation (2026-10-18):** in the Claude Code environment, `npm ci`, both
builds, the API tests and the running apps passed with these exact versions
(see `VERIFICATION.md`); no version had to change and no Vitest plugin was
needed. Windows validation passed on 2026-10-18 (`npm ci`, build, tests,
running apps). Note: `@types/node` 26.6.5 also
appears at the root of `node_modules` as an optional peer of the Nest CLI's
prompt library; the workspaces use their pinned 24.19.2.

Linux Node binary: `nodejs.org` is not reachable from Claude's workspace. The
Node 24.22.0 binary there comes from the npm package
`node-linux-x64@24.22.0`, a third-party repackaging (`node-bin-gen`). npm
checked its integrity against the registry, not against the official Node.js
checksums. The Windows PC uses the official installer.

**Windows — executed (2026-10-17):** Node was updated in place with the
official MSI `node-v24.22.0-x64.msi` (the existing install was the MSI in
`C:\Program Files\nodejs\`). Result: `node --version` → `v24.22.0`,
`npm --version` → `11.19.1`, `process.release.lts` → `Krypton`; `node` and
`npm` both resolve to `C:\Program Files\nodejs\`. Note: winget correlates this
install with the package ID `OpenJS.NodeJS.22` (now listed as 24.22.0), so
`winget upgrade` must not be used on that ID. The output of the SHA-256 check of
the MSI against the official `SHASUMS256.txt` was not shared, so that check is
not recorded as passed.

**Windows — pending:** `npm ci` (including the skip of the optional 32-bit
`sharp` package), build and tests.

### E-005 — API module system: ESM with Vitest

**Status:** Accepted (2026-10-18). Proposed 2026-10-17.

- In `@nestjs/schematics` 12.0.7, the application schematic's `type` option
  defaults to `esm`, and the ESM template uses Vitest.
- Prisma 7 ships as an ES module. Prisma's NestJS recipe notes that the ESM
  client uses `import.meta`, which is not available in CommonJS.

Decision: `apps/api` uses `"type": "module"`, relative imports with `.js`
extensions, the `prisma-client` generator with an explicit
`moduleFormat = "esm"` (and `importFileExtension = "js"`, because the
generator otherwise emits `.ts` import paths), and Vitest for tests. CommonJS-only examples from
older tutorials do not apply directly.

### E-006 — Enforcing Node and npm versions

**Status:** Accepted (2026-10-18). Proposed 2026-10-17.

- `.nvmrc` and `.node-version` contain `24.22.0`. The README states Node
  24.22.0 and npm 11.19.1.
- The root `package.json` has `"packageManager": "npm@11.19.1"` and
  `"engines": { "node": ">=24.22.0 <25", "npm": ">=11.19.1 <12" }`.
- `.npmrc` sets `engine-strict=true`.

The exact version is the reference for both environments. The `engines` range
rejects older or other major versions without blocking a reviewer on a later
24.x patch.

**Verified (2026-10-18, Claude Code environment):** `npm ci` with Node 22.22.0
fails with `EBADENGINE` before installing anything.

### E-007 — Environment variables

**Status:** Accepted (2026-10-18). Proposed 2026-10-17.

- `.env` files are git-ignored. A committed `.env.example` documents every
  variable, with local development values only and no secrets.
- The API loads `apps/api/.env` with `dotenv`, both in its entry point and
  in `prisma.config.ts`, because Prisma 7 does not load `.env` automatically.
  `prisma.config.ts` reads `process.env.DATABASE_URL` directly (not Prisma's
  `env()` helper) so that `prisma generate` works without a `.env` file;
  commands that need the database fail with a clear message instead.
- The web app reads `apps/web/.env` (loaded by Next.js itself).
- The web app reads the API base URL from `API_BASE_URL`, used **only on the
  Next.js server** (server components), so the browser never needs it and it
  is not exposed with a `NEXT_PUBLIC_` prefix.
- `@nestjs/config` is not used; plain `dotenv` covers the needs of the
  project.

### E-008 — Cross-platform scripts and files

**Status:** Accepted with adjustments (2026-10-18). Proposed 2026-10-17.

Reason: on Windows, npm runs scripts with `cmd.exe` even when invoked from
PowerShell, so shell-specific syntax that works in bash fails there.

- npm scripts call only project-local binaries and Node. No `rm -rf`, no
  `export VAR=…`, and no shell-specific syntax. The scripts are the same on
  every platform; where a **preparation** step differs (for example copying
  `.env.example` to `.env`), the README documents a PowerShell variant next
  to the bash one.
- The lockfile is created or updated deliberately with `npm install` and
  explicit exact versions (`npm install <pkg>@<x.y.z>`); it is reproduced
  with `npm ci`. (Refines E-003.)
- Before adding any Vitest plugin (for example to emit decorator metadata),
  verify that the API starts and stops cleanly and that a real dependency
  injected by Nest works under Vitest as configured. A plugin is added only if
  that check fails, and is then recorded under E-004.
- Parallel dev servers run with `concurrently`.
- `.gitattributes` sets `* text=auto eol=lf`.
- `.gitignore` excludes `.env`, `node_modules`, build output, the generated
  Prisma client (regenerated with `prisma generate`) and temporary files.
- Committed: sources, Prisma schema and migrations, the lockfile,
  `.env.example` and documentation.

### E-009 — Repository workflow and push

**Status:** Accepted (2026-10-18).

Workflow:

- The first commit on `main` contains only documentation and root
  configuration (`.gitignore`, `.gitattributes`).
- Each milestone is developed on its own branch and proposed as a pull
  request. The author merges it only after reproducing **the same commit** on
  Windows, so `main` only contains work verified in both environments.
- Small, descriptive commits. No force push; existing history is preserved.
- `Technical_Test.pdf` is local reference material: it is never committed or
  published (also listed in `.gitignore`).
- Commit author: `Emilio Arias <262922545+emilioarias-dev@users.noreply.github.com>`
  (GitHub no-reply address, so no personal email is published); Claude is
  credited with a `Co-Authored-By` trailer.
- If pushing is not possible, commits are kept and handed over as a
  `git bundle`.

History before 2026-10-18:

- **Linux — executed:** `gh auth status` fails because the token in Claude's
  workspace is invalid; read-only `git ls-remote` to a public GitHub
  repository works.
- **Available mechanism:** attaching the author's GitHub repository to this
  session with write access. It requires the repository to exist and the
  author's GitHub authorization. Attempted on 2026-10-17 for
  `emilioarias-dev/smart-cycle-count` (repository created by the author):
  failed with "link your GitHub account to let Claude access repositories".
  Requires linking GitHub in claude.ai (Settings → Connectors).
  Second attempt after the author linked GitHub: the repository was attached
  and cloned (read access works; the repository is empty). The session
  reports its push check as **refused**: the Claude GitHub App does not have
  access to this repository. Fix: install the Claude GitHub App for the
  repository (github.com/apps/claude) or re-link GitHub from claude.ai.
  No push attempted yet.
- Until a push is demonstrated, commits stay where they were made and can be
  handed over as a `git bundle`. No push is reported as done until it
  succeeds.
- Repository: `https://github.com/emilioarias-dev/smart-cycle-count`, created
  by the author, empty (branch `main`, no commits) at the time of the
  handoff.
- At the handoff, the author reports having connected the repository to
  Claude Code. Write access from Claude Code has not been verified; it is the
  first check of the next session.

---

## Deferred decisions

To be decided when the corresponding milestone starts:

Deferred to their own branches (D-014): the Rivy assistant (Gemini,
read-only; model and effective quota to be checked) and the author's data
analysis contribution. The 3D heatmap was decided in D-015.

Decided in milestone 5: unexpected pallet capture, retries, conflicts and
results in scoring (D-012, D-010 v2); demo reset with counts (D-009).

Decided in milestone 4: plan rules (N limits and default, tie-break, bins
with pending tasks or without a score) in D-011; demo reset with plans in
D-009.

Decided in milestone 3: scoring factors, weights, window and normalisation
(D-010).

Decided in milestone 2 (previously deferred): layout and bin codes (D-006),
inventory representation (D-007), movement semantics (D-008), seed design
and audit antecedents (D-009).
