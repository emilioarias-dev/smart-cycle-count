import Link from 'next/link';
import { connection } from 'next/server';
import { StatusCard } from '../../components/StatusCard';
import { type AuditTask, getAuditTasks } from '../../lib/api';
import { utcDateTime } from '../../lib/format';

// Audit tasks grouped by plan, newest plan first. Each row shows the score
// copied when the plan was created, not the current one (D-002).
export default async function TasksPage() {
  await connection();
  const result = await getAuditTasks();

  return (
    <main className="page">
      <header className="header">
        <p className="eyebrow">Smart Cycle Count</p>
        <h1>Audit tasks</h1>
        <p className="lead">Bins selected by each Top N plan, with the score that selected them.</p>
      </header>

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

  return (
    <section className="card plan" aria-label={`Plan ${plan.id}`}>
      <h2>Plan #{plan.id}</h2>
      <p className="plan-meta">
        {plan.createdCount} of {plan.requestedCount} requested · created {utcDateTime(plan.createdAt)}
        {skipped.length > 0 && <> · skipped {skipped.join(', ')}</>}
      </p>
      <p className="plan-meta muted">Scores as of {references.map(utcDateTime).join(', ')}</p>
      <table className="tasks">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Bin</th>
            <th scope="col">Score at selection</th>
            <th scope="col" className="status-col">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id}>
              <td>{task.rank}</td>
              <td>
                <Link className="bin-link" href={`/bins/${task.bin.code}`}>
                  {task.bin.code}
                </Link>
              </td>
              <td>
                <span className={`score-chip priority-${task.score.priority}`}>
                  <strong>{task.score.value}</strong> {task.score.label.replace(' priority', '')}
                </span>
              </td>
              <td className="status-col">
                {task.status === 'PENDING' ? (
                  <Link className="status status-pending" href={`/count?bin=${task.bin.code}`}>
                    Count
                  </Link>
                ) : (
                  <span className={`status status-done result-${task.count?.result.toLowerCase() ?? 'unknown'}`}>Done · {task.count?.result ?? '?'}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
