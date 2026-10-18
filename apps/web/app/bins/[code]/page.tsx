import Link from 'next/link';
import { connection } from 'next/server';
import { StatusCard } from '../../../components/StatusCard';
import { getBin } from '../../../lib/api';
import { auditLabel, plural, twoDigits } from '../../../lib/format';

// Bin detail: location, simulated audit antecedent and current pallets.
export default async function BinPage({ params }: { params: Promise<{ code: string }> }) {
  await connection();
  const { code } = await params;
  const requested = decodeURIComponent(code);
  const result = await getBin(requested);

  return (
    <main className="page">
      <nav>
        <Link className="back" href="/">
          ← Warehouse
        </Link>
      </nav>

      {result.status === 'error' && (
        <StatusCard kind="error" title="Could not load the bin" action={{ href: `/bins/${code}`, label: 'Try again' }}>
          {result.reason}
        </StatusCard>
      )}

      {result.status === 'not-found' && (
        <StatusCard kind="notice" title="Bin not found" action={{ href: '/', label: 'Back to the warehouse' }}>
          There is no bin with code <code>{requested}</code>.
        </StatusCard>
      )}

      {result.status === 'ok' && (
        <>
          <header className="header">
            <p className="eyebrow">Bin</p>
            <h1 className="bin-title">{result.data.code}</h1>
            <p className="lead">
              Aisle {result.data.aisle} · Rack {twoDigits(result.data.rack)} · Position {twoDigits(result.data.position)}
            </p>
          </header>

          <section className="card" aria-label="Bin facts">
            <dl className="fields">
              <div>
                <dt>Last audit</dt>
                <dd>{auditLabel(result.data.lastAuditedAt)}</dd>
              </div>
              <div>
                <dt>Pallets</dt>
                <dd>{result.data.pallets.length}</dd>
              </div>
              <div>
                <dt>Inventory version</dt>
                <dd>{result.data.inventoryVersion}</dd>
              </div>
            </dl>
            <p className="footnote">
              The last audit date is simulated demo data; there are no audit results behind it yet.
            </p>
          </section>

          <section className="pallets" aria-label="Pallets in this bin">
            <h2>Pallets</h2>
            {result.data.pallets.length === 0 ? (
              <p className="muted">This bin is empty.</p>
            ) : (
              <ul className="pallet-list">
                {result.data.pallets.map((pallet) => (
                  <li key={pallet.code} className="pallet">
                    <div>
                      <p className="pallet-code">{pallet.code}</p>
                      <p className="pallet-product">
                        {pallet.product.name} <span className="muted">· {pallet.product.sku}</span>
                      </p>
                    </div>
                    <p className="pallet-quantity">{plural(pallet.quantity, pallet.product.unit)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
