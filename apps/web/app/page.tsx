import Link from 'next/link';
import { connection } from 'next/server';
import { BreakdownChart } from '../components/BreakdownChart';
import { Icon } from '../components/Icon';
import { StatusCard } from '../components/StatusCard';
import { TaskState } from '../components/TaskState';
import { WarehouseHead } from '../components/WarehouseHead';
import { type ApiResult, type AuditTask, type Priority, type ScoreSummary, type TopScore, type WarehouseLayout, getAuditTasks, getTopScores, getWarehouse } from '../lib/api';
import { plural, twoDigits, utcDateTime } from '../lib/format';

type Bin = WarehouseLayout['aisles'][number]['racks'][number]['bins'][number];

const BANDS: Priority[] = ['high', 'medium', 'low'];
const BAND_NAME: Record<Priority, string> = { high: 'High', medium: 'Medium', low: 'Low' };

// The warehouse dashboard (D-013): an overview band, the heatmap by aisle and
// rack colored by audit priority (D-010; color always with the number and a
// label), the latest plan, and the score breakdown of the Top 5 bins.
export default async function WarehousePage() {
  // Rendered on every request, never at build time.
  await connection();
  const [warehouse, tasks, top] = await Promise.all([getWarehouse(), getAuditTasks(), getTopScores()]);

  if (warehouse.status !== 'ok') {
    return (
      <main className="shell">
        <PlainHead />
        {warehouse.status === 'error' ? (
          <StatusCard kind="error" title="Could not load the warehouse" action={{ href: '/', label: 'Try again' }}>
            {warehouse.reason}
          </StatusCard>
        ) : (
          <StatusCard kind="error" title="Could not load the warehouse">
            The API does not provide the warehouse layout (GET /warehouse returned 404).
          </StatusCard>
        )}
      </main>
    );
  }

  const { aisles } = warehouse.data;
  const bins = aisles.flatMap((a) => a.racks.flatMap((r) => r.bins));
  if (bins.length === 0) {
    return (
      <main className="shell">
        <PlainHead />
        <StatusCard kind="notice" title="No bins yet">
          The database has no bins. Load the demo data with <code>npm run db:reset-demo</code>, then reload this page.
        </StatusCard>
      </main>
    );
  }

  const latest = tasks.status === 'ok' ? latestPlan(tasks.data) : null;
  const pendingBins = new Set(tasks.status === 'ok' ? tasks.data.filter((t) => t.status === 'PENDING').map((t) => t.bin.code) : []);
  const latestByBin = new Map((latest ?? []).map((t) => [t.bin.code, t]));
  const current = new Map(bins.map((b) => [b.code, b.score]));
  const bands = { high: 0, medium: 0, low: 0 };
  for (const bin of bins) {
    if (bin.score) {
      bands[bin.score.priority] += 1;
    }
  }
  const scored = bins.filter((b) => b.score).length;

  return (
    <main className="shell">
      <WarehouseHead binCount={bins.length} aisleCount={aisles.length} scoresAsOf={scoresAsOf(bins)} />

      <section className="band" aria-label="Overview">
        <div className="band-grid">
          <div className="metric">
            <span className="metric-title">Priority mix</span>
            <div className="metric-value num">
              {BANDS.map((p) => (
                <span key={p} className="mix">
                  <i style={{ background: `var(--${p}-edge)` }} aria-hidden="true" />
                  {bands[p]}
                  <small className="hide-sm" aria-hidden="true">
                    {' '}
                    {p}
                  </small>
                  <span className="sr-only"> {p}</span>
                </span>
              ))}
            </div>
            <div className="segbar" aria-hidden="true">
              {BANDS.filter((p) => bands[p] > 0).map((p) => (
                <span key={p} style={{ flex: bands[p], background: `var(--${p}-edge)` }} />
              ))}
            </div>
          </div>
          <PlanMetric tasks={tasks} latest={latest} />
          <div className="metric">
            <span className="metric-title">Never audited</span>
            <div className="metric-value num">
              {bins.filter((b) => b.lastAuditedAt === null).length}
              <small> / {plural(bins.length, 'bin')}</small>
            </div>
            <span className="metric-detail">Before a first count, audit dates are simulated</span>
          </div>
        </div>
        <p className="band-scope">
          Scope:{' '}
          <b>{scored === bins.length ? `all ${plural(bins.length, 'bin')}` : `${scored} of ${plural(bins.length, 'bin')} scored`}</b>
          {latest && (
            <>
              {' '}
              · <b>plan #{latest[0].plan.id}</b>
              <span className="hide-sm">, created {utcDateTime(latest[0].plan.createdAt)}</span>
            </>
          )}
        </p>
      </section>

      <div className="layout">
        <section className="panel" aria-labelledby="heatmap-title">
          <div className="panel-head">
            <h2 id="heatmap-title">
              Heatmap<span className="dot">.</span>
            </h2>
            <ul className="legend" aria-label="Priority bands">
              <li className="chip high">High · 70–100</li>
              <li className="chip medium">Medium · 40–69</li>
              <li className="chip low">Low · 0–39</li>
            </ul>
          </div>
          <div className="panel-body">
            {aisles.map((aisle) => (
              <section key={aisle.aisle} className="aisle" aria-label={`Aisle ${aisle.aisle}`}>
                <p className="rule">
                  Aisle {aisle.aisle}
                  <span className="count">
                    {plural(aisle.racks.reduce((n, r) => n + r.bins.length, 0), 'bin')} · {plural(aisle.racks.length, 'rack')}
                  </span>
                </p>
                {aisle.racks.map((rack) => (
                  <ul key={rack.rack} className="rack" aria-label={`Rack ${aisle.aisle}-${twoDigits(rack.rack)}`}>
                    <li className="rack-label" aria-hidden="true">
                      <span className="rack-short">Rack {twoDigits(rack.rack)}</span>
                      <span className="rack-full">
                        Rack {aisle.aisle}-{twoDigits(rack.rack)}
                      </span>
                    </li>
                    {rack.bins.map((bin) => (
                      <li key={bin.code}>
                        <BinTile bin={bin} pending={pendingBins.has(bin.code)} latest={latestByBin.get(bin.code)} />
                      </li>
                    ))}
                  </ul>
                ))}
              </section>
            ))}
            <div className="keyline">
              <span className="marker">
                <Icon name="clock" />
                TASK
              </span>
              Pending task
              <span className="marker">
                <Icon name="check" />
                PASS
              </span>
              <span className="marker">
                <Icon name="x" />
                FAIL
              </span>
              <span>Last count {latest ? `in plan #${latest[0].plan.id}` : 'in the latest plan'}</span>
            </div>
            {bands.high === 0 && (
              <p className="note">
                <Icon name="info" />
                <span>No bin is in the high band in this snapshot.</span>
              </p>
            )}
          </div>
        </section>

        <aside className="side">
          <LatestPlanPanel tasks={tasks} latest={latest} current={current} />
          <section className="panel" aria-labelledby="breakdown-title">
            <div className="panel-head">
              <h2 id="breakdown-title">
                Score breakdown · Top 5 bins<span className="dot">.</span>
              </h2>
              <p className="panel-sub">Current scores of all bins, plan or not. Points per factor on a 0–100 scale; select a bar for its values.</p>
            </div>
            <div className="panel-body">
              <TopChart top={top} />
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function PlainHead() {
  return (
    <section className="page-head">
      <div>
        <p className="eyebrow">Audit priority/</p>
        <h1>
          Warehouse<span className="dot">.</span>
        </h1>
      </div>
    </section>
  );
}

function BinTile({ bin, pending, latest }: { bin: Bin; pending: boolean; latest: AuditTask | undefined }) {
  const result = latest?.status === 'DONE' ? latest.count?.result : undefined;
  const state = pending ? ', pending task' : result ? `, last count ${result}` : '';
  return (
    <Link
      className="bin"
      href={`/bins/${bin.code}`}
      data-p={bin.score?.priority}
      aria-label={`Bin ${bin.code}, ${bin.score ? `score ${bin.score.value}, ${bin.score.label}` : 'not scored'}, ${plural(bin.palletCount, 'pallet')}${state}`}
    >
      <span className="bin-code">{bin.code}</span>
      <span className="bin-pos num">{twoDigits(bin.position)}</span>
      <span className="bin-score num">
        <b>{bin.score ? bin.score.value : '—'}</b>
        <span className="band-label">{bin.score ? BAND_NAME[bin.score.priority] : 'Not scored'}</span>
      </span>
      <span className="bin-foot">
        <span className="bin-meta">{bin.palletCount === 0 ? 'Empty' : plural(bin.palletCount, 'pallet')}</span>
        {pending ? (
          <span className="marker">
            <Icon name="clock" />
            TASK
          </span>
        ) : result ? (
          <span className="marker">
            <Icon name={result === 'PASS' ? 'check' : 'x'} />
            {result}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function PlanMetric({ tasks, latest }: { tasks: ApiResult<AuditTask[]>; latest: AuditTask[] | null }) {
  if (!latest) {
    return (
      <div className="metric">
        <span className="metric-title">Latest plan</span>
        <div className="metric-value">{tasks.status === 'ok' ? <small>No plan yet</small> : <small>Unavailable</small>}</div>
        <span className="metric-detail">{tasks.status === 'ok' ? 'Create a Top N plan to start counting' : 'The tasks could not be loaded'}</span>
      </div>
    );
  }
  const id = latest[0].plan.id;
  const done = latest.filter((t) => t.status === 'DONE');
  const fails = done.filter((t) => t.count?.result === 'FAIL').length;
  return (
    <div className="metric">
      <span className="metric-title">
        <span className="hide-sm">Plan #{id} progress</span>
        <span className="only-sm">Plan #{id}</span>
      </span>
      <div className="metric-value num">
        {done.length}
        <small> / {latest.length} counted</small>
      </div>
      <div className="progress" aria-hidden="true">
        <span style={{ width: `${(done.length / latest.length) * 100}%` }} />
      </div>
      <span className="metric-detail">
        {done.length - fails} PASS · {fails} FAIL · {latest.length - done.length} pending
      </span>
    </div>
  );
}

function LatestPlanPanel({ tasks, latest, current }: { tasks: ApiResult<AuditTask[]>; latest: AuditTask[] | null; current: Map<string, ScoreSummary | null> }) {
  if (tasks.status !== 'ok') {
    return (
      <StatusCard kind="error" title="Could not load the tasks" action={{ href: '/', label: 'Try again' }}>
        {tasks.status === 'error' ? tasks.reason : 'The API does not provide the task list (GET /audit-tasks returned 404).'}
      </StatusCard>
    );
  }
  if (!latest) {
    return (
      <StatusCard kind="notice" title="No plans yet">
        Create a Top N plan above: it selects the bins with the highest scores.
      </StatusCard>
    );
  }
  const total = latest.length;
  return (
    <section className="panel" aria-labelledby="plan-title">
      <div className="panel-head">
        <h2 id="plan-title">
          Plan #{latest[0].plan.id}
          <span className="dot">.</span>
        </h2>
        <p className="panel-sub">Selected = score when the plan was created · Now = current score</p>
      </div>
      <div className="panel-body">
        <ol className="plan-list">
          {latest.map((task) => {
            const now = current.get(task.bin.code);
            return (
              <li key={task.id} className="plan-item">
                <span className="index num">
                  {twoDigits(task.rank)}
                  <small>/{twoDigits(total)}</small>
                </span>
                <span>
                  <Link className="code" href={`/bins/${task.bin.code}`}>
                    {task.bin.code}
                  </Link>
                  <span className="subline num">
                    Selected <b>{task.score.value}</b> · Now {now ? <><b>{now.value}</b> {BAND_NAME[now.priority]}</> : 'not scored'}
                  </span>
                </span>
                <TaskState task={task} />
              </li>
            );
          })}
        </ol>
        <p className="note">
          <Link href="/tasks">All plans and tasks</Link>
        </p>
      </div>
    </section>
  );
}

function TopChart({ top }: { top: ApiResult<TopScore[]> }) {
  if (top.status !== 'ok') {
    return (
      <StatusCard kind="error" title="Could not load the Top 5">
        {top.status === 'error' ? top.reason : 'The API does not provide the top scores (GET /scores/top returned 404).'}
      </StatusCard>
    );
  }
  if (top.data.length === 0) {
    return <p className="muted">No bin has a score yet: recompute the scores.</p>;
  }
  return <BreakdownChart entries={top.data} />;
}

// GET /audit-tasks lists the newest plan first.
function latestPlan(tasks: AuditTask[]): AuditTask[] | null {
  if (tasks.length === 0) {
    return null;
  }
  const id = Math.max(...tasks.map((t) => t.plan.id));
  return tasks.filter((t) => t.plan.id === id).sort((a, b) => a.rank - b.rank);
}

// All scores share one reference after a recompute; say so if they do not.
function scoresAsOf(bins: Bin[]): string {
  const references = new Set(bins.map((b) => b.score?.reference ?? null));
  if (references.size === 1) {
    const [only] = references;
    return only ? `Scores as of ${utcDateTime(only)}` : 'Not scored yet: recompute the scores.';
  }
  return 'Scores have different reference times: recompute to align them.';
}
