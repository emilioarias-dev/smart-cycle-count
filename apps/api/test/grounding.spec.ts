import { unsupported } from '../src/assistant/grounding.js';

// What Rivy may state: only what this question's tool results contain, and a
// figure written next to a bin code only if it is that bin's. Written forms of
// the same value are accepted.
describe('Rivy answer grounding', () => {
  const bin = {
    code: 'B-02-03',
    queriedAt: '2026-10-20T23:05:27.346Z',
    palletCount: 4,
    currentScore: { value: 63, band: 'Medium priority', scoreTime: '2026-10-20T22:38:58.831Z', totalBeforeRounding: 63.32, factors: [{ factor: 'time since last audit', input: '86.47 days', points: 28.82 }] },
    lines: [{ pallet: 'P-0026', sku: 'SKU-012', expected: 33, counted: 31, variance: -2 }],
    links: [{ label: 'Bin B-02-03', href: '/bins/B-02-03' }],
  };
  const compare = {
    queriedAt: '2026-10-20T23:07:22.798Z',
    higherPriority: 'A-02-01',
    decidedBy: 'higher score: A-02-01',
    bins: [
      { code: 'A-02-01', currentScore: { value: 57, factors: [{ input: 2, points: 8 }] } },
      { code: 'B-01-05', currentScore: { value: 55, factors: [{ input: 1, points: 4 }] } },
    ],
  };
  const rules = { rulesVersion: '2026-10-20 (score formula v2)', rules: { score: ['Bands: High 70-100, Medium 40-69, Low 0-39.'] } };

  it('accepts the values as returned and their usual written forms', () => {
    const answers = [
      'B-02-03 has a current score of 63 (Medium priority), score time 2026-10-20T22:38:58.831Z. See /bins/B-02-03.',
      'B-02-03: puntuación 63,32 → 63; 86.47 días dan 28,8 puntos. Calculada el 2026-10-20 22:38 UTC (20 de octubre de 2026, 22:38:58).',
      'B-02-03 has 4 pallets. P-0026 (SKU-012): 31/33, variance -2. Pages: /tasks, /count and the Warehouse (/).',
      "1. B-02-03\n2. The app's records do not show more.",
    ];
    for (const answer of answers) {
      expect(unsupported(answer, [bin])).toEqual([]);
    }
  });

  it('accepts each figure next to its own bin, and shared rule values', () => {
    expect(unsupported('A-02-01 (57) comes before B-01-05 (55): A-02-01 has 2 adjustments (8 points), B-01-05 has 1 (4 points).', [compare])).toEqual([]);
    expect(unsupported('57 vs 55: A-02-01 first.', [compare])).toEqual([]);
    expect(unsupported('B-02-03 (63) is Medium (40-69).', [bin, rules])).toEqual([]);
  });

  it('reports figures swapped between bins', () => {
    expect(unsupported('A-02-01 (55) comes before B-01-05 (57).', [compare])).toEqual(['55 for A-02-01', '57 for B-01-05']);
    expect(unsupported('B-01-05 has 2 adjustments.', [compare])).toEqual(['2 for B-01-05']);
  });

  it('reports small invented quantities', () => {
    expect(unsupported('B-02-03 has 3 pallets.', [bin])).toEqual(['3 for B-02-03']);
    expect(unsupported('There are 7 pending tasks.', [bin])).toEqual(['7']);
  });

  it('a number written after a code in the results counts for that bin', () => {
    const missingBin = { found: false, code: 'Z-09-09', message: 'There is no bin Z-09-09. Codes look like A-01-03 (aisles A-C, racks 01-02, positions 01-05).' };
    expect(unsupported('Z-09-09 does not exist. Codes look like A-01-03 (racks 01-02, positions 01-05).', [missingBin])).toEqual([]);
    expect(unsupported('Z-09-09 does not exist; A-01-03 has 7 pallets.', [missingBin])).toEqual(['7 for A-01-03']);
  });

  it('the question is not a source: a value only the question gave is reported', () => {
    expect(unsupported('Yes, B-02-03 has a score of 99.', [bin])).toEqual(['99 for B-02-03']);
    expect(unsupported('Z-99-99 does not exist.', [])).toEqual(['Z-99-99']);
  });

  it('reports bins, ids, links, times and numbers that the results do not contain', () => {
    expect(unsupported('A-01-01 (score 71) and /bins/A-01-02 (70).', [bin])).toEqual(['A-01-01', '/bins/A-01-02', '71 for A-01-01', '70 for A-01-02']);
    expect(unsupported('P-0099, SKU-999; see /warehouse.', [bin])).toEqual(['P-0099', 'SKU-999', '/warehouse']);
    expect(unsupported('Data as of 2026-10-20T23:14:45.122Z; scored 2026-10-19; at 23:14 UTC.', [bin])).toEqual(['2026-10-20T23:14:45.122Z', '2026-10-19', '23:14']);
    expect(unsupported('63.4 points; 28.9 points; 64.', [bin])).toEqual(['63.4', '28.9', '64']);
  });

  it('earlier answers are not a source: without tool results, a figure is unsupported', () => {
    expect(unsupported('B-02-03 still has 63.', [])).toEqual(['B-02-03', '63 for B-02-03']);
  });
});
