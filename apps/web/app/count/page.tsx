import Link from 'next/link';
import { connection } from 'next/server';
import { CountForm } from '../../components/CountForm';
import { Icon } from '../../components/Icon';
import { StatusCard } from '../../components/StatusCard';
import { getCountSheet } from '../../lib/api';
import { twoDigits } from '../../lib/format';

// The count page (D-012): search or scan a bin code, then count the bin's
// pending task. A keyboard-wedge scanner types into the same field.
export default async function CountPage({ searchParams }: { searchParams: Promise<{ bin?: string | string[] }> }) {
  await connection();
  const { bin } = await searchParams;
  const code = (Array.isArray(bin) ? bin[0] : bin)?.trim() ?? '';
  const result = code ? await getCountSheet(code) : null;

  return (
    <main className="shell">
      <section className="page-head">
        <div>
          <p className="eyebrow">Cycle count/</p>
          <h1>
            Count a bin<span className="dot">.</span>
          </h1>
          <p className="page-meta">Type or scan the bin code. Only bins with a pending audit task can be counted.</p>
        </div>
      </section>

      <form className="search" action="/count">
        <div>
          <label className="field-label" htmlFor="bin-code">
            Bin code
          </label>
          <input id="bin-code" className="input" name="bin" defaultValue={code} placeholder="A-01-03" autoCapitalize="characters" autoComplete="off" required />
        </div>
        <button type="submit" className="btn btn-primary">
          <Icon name="search" />
          Find
        </button>
      </form>

      <div className="stack">
        {result?.status === 'not-found' && (
          <StatusCard kind="notice" title="Bin not found">
            There is no bin with code <code>{code}</code>.
          </StatusCard>
        )}
        {result?.status === 'error' && (
          <StatusCard kind="notice" title="Cannot count this bin" action={{ href: '/tasks', label: 'See the tasks' }}>
            {result.reason}
          </StatusCard>
        )}
        {result?.status === 'ok' && (
          <>
            <section className="panel" aria-label="Task">
              <div className="task-card">
                <div>
                  <p className="eyebrow" style={{ margin: 0 }}>
                    Task/
                  </p>
                  <h2>
                    {result.data.bin.code}
                    <span className="dot">.</span>
                  </h2>
                </div>
                <span className="subline">
                  Plan #{result.data.task.planId} · task {twoDigits(result.data.task.rank)} · <Link href={`/bins/${result.data.bin.code}`}>Bin details</Link>
                </span>
              </div>
            </section>
            {/* A new task gets a fresh form. */}
            <CountForm key={result.data.task.id} sheet={result.data} />
          </>
        )}
      </div>
    </main>
  );
}
