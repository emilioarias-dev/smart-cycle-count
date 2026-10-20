// node --test: the 3D heatmap geometry, without a browser. Occlusion is
// measured with three's raycaster from the fixed view direction, the same
// one the scene uses.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BoxGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { BASE, type Bin3D, FOOTPRINT, RISE, UNSCORED_HEIGHT, columnHeight, layout3d, viewDirection } from './heatmap3d.ts';

const band = (v: number) => (v >= 70 ? 'high' : v >= 40 ? 'medium' : 'low');
function warehouse(score: (aisle: number, rack: number, position: number) => number | null): Bin3D[] {
  const bins: Bin3D[] = [];
  ['A', 'B', 'C'].forEach((aisle, a) => {
    for (const rack of [1, 2]) {
      for (const position of [1, 2, 3, 4, 5]) {
        const value = score(a, rack, position);
        bins.push({
          code: `${aisle}-0${rack}-0${position}`,
          aisle,
          rack,
          position,
          palletCount: 3,
          score: value === null ? null : { value, priority: band(value), label: `${band(value)} priority` },
          task: null,
        });
      }
    }
  });
  return bins;
}

// Share of each bin's top face that the camera sees (sampled on a grid).
function visibleTop(bins: Bin3D[]): Map<string, number> {
  const { cells } = layout3d(bins);
  const meshes = cells.map((c) => {
    const m = new Mesh(new BoxGeometry(FOOTPRINT, c.height, FOOTPRINT), new MeshBasicMaterial());
    m.position.set(c.x, c.height / 2, c.z);
    m.userData.code = c.bin.code;
    m.updateMatrixWorld();
    return m;
  });
  const d = viewDirection();
  const towardsCamera = new Vector3(d.x, d.y, d.z);
  const ray = new Raycaster();
  const result = new Map<string, number>();
  const n = 9;
  for (const c of cells) {
    let seen = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const p = new Vector3(c.x - FOOTPRINT / 2 + (FOOTPRINT * (i + 0.5)) / n, c.height + 1e-6, c.z - FOOTPRINT / 2 + (FOOTPRINT * (j + 0.5)) / n);
        ray.set(p.clone().addScaledVector(towardsCamera, 100), towardsCamera.clone().negate());
        if (ray.intersectObjects(meshes)[0]?.object.userData.code === c.bin.code) {
          seen++;
        }
      }
    }
    result.set(c.bin.code, seen / (n * n));
  }
  return result;
}

describe('3D heatmap geometry', () => {
  it('places the 30 bins of the 2D plan: one row per rack, one column per position, no overlap', () => {
    const { cells, rows, columns } = layout3d(warehouse(() => 50));
    assert.equal(cells.length, 30);
    assert.deepEqual(rows.map((r) => r.text), ['A-01', 'A-02', 'B-01', 'B-02', 'C-01', 'C-02']);
    assert.deepEqual(columns.map((c) => c.text), ['01', '02', '03', '04', '05']);
    for (const c of cells) {
      assert.equal(c.row, ['A', 'B', 'C'].indexOf(c.bin.aisle) * 2 + c.bin.rack - 1);
      assert.equal(c.column, c.bin.position - 1);
    }
    // Rows go from the back (A-01) to the front (C-02); columns left to right.
    const z = rows.map((r) => r.z);
    assert.deepEqual([...z].sort((a, b) => a - b), z);
    const keys = new Set(cells.map((c) => `${c.x.toFixed(3)},${c.z.toFixed(3)}`));
    assert.equal(keys.size, 30);
    for (const a of cells) {
      for (const b of cells) {
        if (a !== b) {
          assert.ok(Math.abs(a.x - b.x) >= FOOTPRINT || Math.abs(a.z - b.z) >= FOOTPRINT, `${a.bin.code} overlaps ${b.bin.code}`);
        }
      }
    }
  });

  it('uses one fixed linear 0–100 scale; 0 keeps a base; no score is a flat tile below it', () => {
    const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
    close(columnHeight(0), BASE);
    close(columnHeight(100), BASE + RISE);
    close(columnHeight(50), BASE + RISE / 2);
    close(columnHeight(25) - columnHeight(0), columnHeight(100) - columnHeight(75));
    assert.equal(columnHeight(null), UNSCORED_HEIGHT);
    assert.ok(UNSCORED_HEIGHT < BASE && UNSCORED_HEIGHT > 0);
    // The height comes from the score only, the same for every bin.
    const heights = layout3d(warehouse((a, r, p) => (a + r + p) * 7)).cells.map((c) => [c.bin.score!.value, c.height]);
    for (const [score, height] of heights) {
      assert.equal(height, columnHeight(score));
    }
  });

  const cases: [string, (a: number, r: number, p: number) => number | null][] = [
    ['all 0', () => 0],
    ['all 100', () => 100],
    ['alternate rows 0 / 100', (a, r) => ((a * 2 + r) % 2 === 0 ? 0 : 100)],
    ['alternate rows 100 / 0', (a, r) => ((a * 2 + r) % 2 === 0 ? 100 : 0)],
    ['alternate columns 100 / 0', (_a, _r, p) => (p % 2 ? 100 : 0)],
    ['alternate columns 0 / 100', (_a, _r, p) => (p % 2 ? 0 : 100)],
    ['checkerboard', (a, r, p) => ((a * 2 + r + p) % 2 ? 100 : 0)],
    ['checkerboard, other phase', (a, r, p) => ((a * 2 + r + p) % 2 ? 0 : 100)],
    ['bins without a score next to 100', (a, r, p) => ((a * 2 + r + p) % 2 ? null : 100)],
  ];
  for (const [name, score] of cases) {
    it(`keeps at least half of every top face visible: ${name}`, () => {
      const visible = visibleTop(warehouse(score));
      const worst = [...visible.entries()].sort((x, y) => x[1] - y[1])[0];
      assert.ok(worst[1] >= 0.5, `${worst[0]} shows ${(worst[1] * 100).toFixed(0)}% of its top`);
    });
  }
});
