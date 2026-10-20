import type { AuditTask, CountResult } from '../lib/api';
import { Icon } from './Icon';

// A task's state (PENDING / DONE, neutral) is shown apart from its count
// result (PASS / FAIL, colored), which only a DONE task has.
export function TaskStatus({ status }: { status: AuditTask['status'] }) {
  return status === 'PENDING' ? (
    <span className="status">
      <Icon name="clock" />
      Pending
    </span>
  ) : (
    <span className="status done">Done</span>
  );
}

export function ResultBadge({ result, small = false }: { result: CountResult; small?: boolean }) {
  return (
    <span className={`result-badge ${result.toLowerCase()}${small ? ' sm' : ''}`}>
      <Icon name={result === 'PASS' ? 'check' : 'x'} />
      {result}
    </span>
  );
}

export function TaskState({ task }: { task: AuditTask }) {
  return (
    <span className="state-result">
      <TaskStatus status={task.status} />
      {task.status === 'DONE' && task.count && <ResultBadge result={task.count.result} small />}
    </span>
  );
}
