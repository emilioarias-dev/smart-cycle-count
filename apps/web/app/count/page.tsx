import Link from 'next/link';
import { connection } from 'next/server';
import { CountForm } from '../../components/CountForm';
import { StatusCard } from '../../components/StatusCard';
import { getCountSheet } from '../../lib/api';

// The count page (D-012): search or scan a bin code, then count the bin's
// pending task. A keyboard-wedge scanner types into the same field.
export default async function CountPage({ searchParams }: { searchParams: Promise<{ bin?: string | string[] }> }) {
  await connection();
  const { bin } = await searchParams;
  const code = (Array.isArray(bin) ? bin[0] : bin)?.trim() ?? '';
  const result = code ? await getCountSheet(code) : null;

  return (
    <main className="page">
      <header className="header">
        <p className="eyebrow">Smart Cycle Count</p>
        <h1>Count a bin</h1>
        <p className="lead">Type or scan the bin code. Only bins with a pending audit task can be counted.</p>
      </header>

      <form className="bin-search" action="/count">
        <label htmlFor="bin-code">Bin code</label>
        <input id="bin-code" name="bin" defaultValue={code} placeholder="A-01-03" autoCapitalize="characters" autoComplete="off" required />
        <button type="submit" className="primary">
          Find
        </button>
      </form>

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
          <section className="card count-header" aria-label="Task">
            <h2 className="bin-title">{result.data.bin.code}</h2>
            <p className="muted">
              Plan #{result.data.task.planId}, task {result.data.task.rank} ·{' '}
              <Link href={`/bins/${result.data.bin.code}`}>Bin details</Link>
            </p>
          </section>
          {/* A new task gets a fresh form. */}
          <CountForm key={result.data.task.id} sheet={result.data} />
        </>
      )}
    </main>
  );
}
