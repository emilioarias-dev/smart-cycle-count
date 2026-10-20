import Link from 'next/link';
import { connection } from 'next/server';
import { Icon } from '../../components/Icon';
import { StatusCard } from '../../components/StatusCard';
import { ResultBadge, TaskStatus } from '../../components/TaskState';
import { type AuditTask, getAuditTasks } from '../../lib/api';
import { twoDigits, utcDateTime } from '../../lib/format';

// Audit tasks grouped by plan, newest plan first. Each row shows the score
// copied when the plan was created, not the current one (D-002), the task's
// state (PENDING / DONE) and, apart, the result of its count (PASS / FAIL).
export default async function TasksPage() {
  await connection();
  const result = await getAuditTasks();

  return (
    <main className="shell">
      <section className="page-head">
        <div>
          <p className="eyebrow">Audit plans/</p>
          <h1>
            Tasks<span className="dot">.</span>
          </h1>
          <p className="page-meta">Bins selected by each Top N plan, with the score that selected them.</p>
        </div>
      </section>

      <div className="stack">
        {result.status === 'error' && (
          <StatusCard kind="error" title="Could not load the tasks" action={{ href: '/tasks', label: 'Try again' }}>
            {result.reason}
          </StatusCard>
        )}
        {result.status === 'not-found' && (
          <StatusCard kind="error" title="Could not load the tasks">
            The API does not provide the task list (GET /audit-tasks returned 404).
          </StatusCard>
        )}
        {result.status === 'ok' && result.data.length === 0 && (
          <StatusCard kind="notice" title="No plans yet" action={{ href: '/', label: 'Go to the warehouse' }}>
            Create a Top N plan from the warehouse page.
          </StatusCard>
        )}
        {result.status === 'ok' && groupByPlan(result.data).map((tasks) => <PlanSection key={tasks[0].plan.id} tasks={tasks} />)}
      </div>
    </main>
  );
}

function PlanSection({ tasks }: { tasks: AuditTask[] }) {
  const { plan } = tasks[0];
  const references = [...new Set(tasks.map((t) => t.score.reference))];
  const skipped = [
    plan.excluded.pendingTask > 0 ? `${plan.excluded.pendingTask} with a pending task` : null,
    plan.excluded.noScore > 0 ? `${plan.excluded.noScore} without a score` : null,
  ].filter(Boolean);
  const done = tasks.filter((t) => t.status === 'DONE').length;
  const total = tasks.length;

  return (
    <section className="panel" aria-labelledby={`plan-${plan.id}`}>
      <div className="panel-head">
        <h2 id={`plan-${plan.id}`}>
          Plan #{plan.id}
          <span className="dot">.</span>
        </h2>
        <p className="page-meta" style={{ width: '100%', margin: 0 }}>
          <span>
            <b className="num">{plan.createdCount}</b> of {plan.requestedCount} requested
          </span>
          <span>
            Created <b className="num">{utcDateTime(plan.createdAt)}</b>
          </span>
          <span>Skipped: {skipped.length > 0 ? skipped.join(', ') : 'none'}</span>
          <span>
            Scores as of <b className="num">{references.map(utcDateTime).join(', ')}</b>
          </span>
        </p>
      </div>
      <div className="panel-body">
        <div className="plan-progress">
          <span className="progress light" aria-hidden="true">
            <span style={{ width: `${(done / total) * 100}%` }} />
          </span>
          <span className="num">
            <b>{done}</b> / {total} counted
          </span>
        </div>
        <table className="table stack-sm">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Bin</th>
              <th scope="col">Score at selection</th>
              <th scope="col">Status</th>
              <th scope="col" className="right">
                Result
              </th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td className="c-index">
                  <span className="index num">
                    {twoDigits(task.rank)}
                    <small>/{twoDigits(total)}</small>
                  </span>
                </td>
                <td className="c-bin">
                  <Link className="code" href={`/bins/${task.bin.code}`}>
                    {task.bin.code}
                  </Link>
                </td>
                <td className="c-score">
                  <span className={`chip ${task.score.priority}`}>
                    <b className="num">{task.score.value}</b> {task.score.label.replace(' priority', '')}
                  </span>
                </td>
                <td className="c-status">
                  <TaskStatus status={task.status} />
                </td>
                <td className="c-result right">
                  {task.status === 'PENDING' ? (
                    <Link className="btn btn-primary btn-sm" href={`/count?bin=${task.bin.code}`} aria-label={`Count bin ${task.bin.code}`}>
                      Count
                      <Icon name="arrow" className="arrow" />
                    </Link>
                  ) : task.count ? (
                    <ResultBadge result={task.count.result} small />
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function groupByPlan(tasks: AuditTask[]): AuditTask[][] {
  const groups = new Map<number, AuditTask[]>();
  for (const task of tasks) {
    groups.set(task.plan.id, [...(groups.get(task.plan.id) ?? []), task]);
  }
  return [...groups.values()];
}
