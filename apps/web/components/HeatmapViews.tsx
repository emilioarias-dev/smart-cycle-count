'use client';

import dynamic from 'next/dynamic';
import { Component, type ReactNode, useState } from 'react';
import type { Bin3D } from '../lib/heatmap3d';

// The heatmap in 2D (the initial view, rendered on the server) or in 3D.
// The 3D code, with Three.js, is downloaded only when 3D is chosen. If it
// cannot start (no WebGL, a lost context, a failed download or a render
// error), the 2D view comes back with a notice.

const Heatmap3D = dynamic(() => import('./Heatmap3D'), {
  ssr: false,
  loading: () => (
    <p className="note" role="status">
      Loading the 3D view…
    </p>
  ),
});

class Fallback extends Component<{ onError: (reason: string) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError('The 3D view could not be loaded.');
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function HeatmapViews({ bins, scoresAsOf, children }: { bins: Bin3D[]; scoresAsOf: string; children: ReactNode }) {
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [notice, setNotice] = useState<string | null>(null);
  const fail = (reason: string) => {
    setView('2d');
    setNotice(`${reason} Showing the 2D heatmap, with the same data.`);
  };

  return (
    <>
      <div className="view-switch" role="group" aria-label="Heatmap view">
        {(['2d', '3d'] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={`btn btn-sm ${view === v ? 'btn-primary' : 'btn-outline'}`}
            aria-pressed={view === v}
            onClick={() => {
              setNotice(null);
              setView(v);
            }}
          >
            {v.toUpperCase()}
          </button>
        ))}
      </div>
      {notice && (
        <p className="callout info" role="status">
          {notice}
        </p>
      )}
      {view === '2d' ? (
        children
      ) : (
        <Fallback onError={fail}>
          <Heatmap3D bins={bins} scoresAsOf={scoresAsOf} onFail={fail} />
        </Fallback>
      )}
    </>
  );
}
