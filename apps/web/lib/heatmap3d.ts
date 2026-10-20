// Geometry of the 3D heatmap: where each bin stands and how tall it is.
// Pure (no DOM, no WebGL), so it is tested on its own with `node --test`.
//
// The floor plan is the 2D heatmap's: one row per rack (aisle by aisle, a
// wider gap between aisles) and one column per position. A bin is a short
// column on the same fixed, linear 0–100 scale for every bin: a score of 0
// keeps a visible base; a bin without a score is a flat, neutral tile. No
// levels or capacity are drawn: the data has none.

export type Priority = 'low' | 'medium' | 'high';

export type Bin3D = {
  code: string;
  aisle: string;
  rack: number;
  position: number;
  palletCount: number;
  score: { value: number; priority: Priority; label: string } | null;
  // Pending task, or the result of the bin's count in the latest plan.
  task: { kind: 'pending'; planId: number } | { kind: 'counted'; planId: number; result: 'PASS' | 'FAIL' } | null;
};

export const FOOTPRINT = 0.8;
export const STEP_X = 1.25;
export const RACK_STEP = 1.4;
export const AISLE_GAP = 0.8;
// Column height = BASE + (score / 100) × RISE. BASE keeps 0 visible.
export const BASE = 0.14;
export const RISE = 1.3;
export const UNSCORED_HEIGHT = 0.06;
// Fixed view: looking down at ELEVATION degrees, turned AZIMUTH degrees
// from straight ahead (positive: seen from the front-left).
export const ELEVATION = 60;
export const AZIMUTH = 14;

export function columnHeight(score: number | null): number {
  if (score === null) {
    return UNSCORED_HEIGHT;
  }
  const clamped = Math.min(100, Math.max(0, score));
  return BASE + (clamped / 100) * RISE;
}

export type Cell = { bin: Bin3D; x: number; z: number; height: number; row: number; column: number };
export type RowLabel = { text: string; x: number; z: number };
export type ColumnLabel = { text: string; x: number; z: number };
export type Layout3D = {
  cells: Cell[];
  rows: RowLabel[];
  columns: ColumnLabel[];
  // Floor rectangle, with room for the labels.
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
};

// Rows go back from the front (positive z) to the back: the first aisle is
// at the back, like the first row of the 2D heatmap at the top.
export function layout3d(bins: Bin3D[]): Layout3D {
  const aisles = [...new Set(bins.map((b) => b.aisle))].sort();
  const racks = new Map<string, number[]>();
  for (const b of bins) {
    racks.set(b.aisle, [...new Set([...(racks.get(b.aisle) ?? []), b.rack])].sort((x, y) => x - y));
  }
  const positions = [...new Set(bins.map((b) => b.position))].sort((x, y) => x - y);

  const rowKeys: { aisle: string; rack: number; z: number }[] = [];
  let z = 0;
  aisles.forEach((aisle, a) => {
    if (a > 0) {
      z += AISLE_GAP;
    }
    for (const rack of racks.get(aisle)!) {
      rowKeys.push({ aisle, rack, z });
      z += RACK_STEP;
    }
  });
  const depth = z - RACK_STEP;
  const width = (positions.length - 1) * STEP_X;
  // Centre the plan on the origin; the first row is the farthest.
  const rowZ = (i: number) => rowKeys[i].z - depth / 2;
  const columnX = (i: number) => i * STEP_X - width / 2;

  const cells = bins.map((bin) => {
    const row = rowKeys.findIndex((r) => r.aisle === bin.aisle && r.rack === bin.rack);
    const column = positions.indexOf(bin.position);
    return { bin, x: columnX(column), z: rowZ(row), height: columnHeight(bin.score?.value ?? null), row, column };
  });
  const labelX = columnX(0) - FOOTPRINT / 2 - 0.25;
  const labelZ = rowZ(rowKeys.length - 1) + FOOTPRINT / 2 + 0.35;
  return {
    cells,
    rows: rowKeys.map((r, i) => ({ text: `${r.aisle}-${String(r.rack).padStart(2, '0')}`, x: labelX, z: rowZ(i) })),
    columns: positions.map((p, i) => ({ text: String(p).padStart(2, '0'), x: columnX(i), z: labelZ })),
    bounds: {
      minX: columnX(0) - FOOTPRINT / 2 - 1.1,
      maxX: columnX(positions.length - 1) + FOOTPRINT / 2 + 0.3,
      minZ: rowZ(0) - FOOTPRINT / 2 - 0.3,
      maxZ: labelZ + 0.35,
    },
  };
}

// Unit vector from the scene towards the camera.
export function viewDirection(): { x: number; y: number; z: number } {
  const e = (ELEVATION * Math.PI) / 180;
  const a = (AZIMUTH * Math.PI) / 180;
  return { x: -Math.sin(a) * Math.cos(e), y: Math.sin(e), z: Math.cos(a) * Math.cos(e) };
}
