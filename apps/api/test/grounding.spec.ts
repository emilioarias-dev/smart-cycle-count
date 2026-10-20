import { unsupported } from '../src/assistant/grounding.js';

// What Rivy may state: only what this question's tool results (or the
// question) contain. Written forms of the same value are accepted.
describe('Rivy answer grounding', () => {
  const result = {
    code: 'B-02-03',
    queriedAt: '2026-10-20T23:05:27.346Z',
    currentScore: { value: 63, band: 'Medium priority', scoreTime: '2026-10-20T22:38:58.831Z', totalBeforeRounding: 63.32, factors: [{ factor: 'time since last audit', input: '86.47 days', points: 28.82 }] },
    lines: [{ pallet: 'P-0026', sku: 'SKU-012', expected: 33, counted: 31, variance: -2 }],
    links: [{ label: 'Bin B-02-03', href: '/bins/B-02-03' }],
  };

  it('accepts the values as returned and their usual written forms', () => {
    const answers = [
      'B-02-03 has a current score of 63 (Medium priority), score time 2026-10-20T22:38:58.831Z. See /bins/B-02-03.',
      'B-02-03: puntuación 63,32 → 63; 86.47 días dan 28,8 puntos. Calculada el 2026-10-20 22:38 UTC (20 de octubre de 2026, 22:38:58).',
      'P-0026 (SKU-012): 31/33, variance -2. Pages: /tasks, /count and the Warehouse (/).',
      '1. Top 5 bins; 2 tools; 10 at most.',
      "The app's records do not show that.",
    ];
    for (const answer of answers) {
      expect(unsupported(answer, [result], 'Why B-02-03?')).toEqual([]);
    }
  });

  it('accepts codes and numbers from the question itself', () => {
    expect(unsupported('Z-99-99 does not exist; I cannot create a plan of 12 bins.', [], 'Create a plan of 12 bins with Z-99-99')).toEqual([]);
  });

  it('reports bins, ids, links, times and numbers that the results do not contain', () => {
    expect(unsupported('A-01-01 (score 71) and /bins/A-01-02 (70).', [result], 'q')).toEqual(['A-01-01', '/bins/A-01-02', '71', '70']);
    expect(unsupported('P-0099, SKU-999; see /warehouse.', [result], 'q')).toEqual(['P-0099', 'SKU-999', '/warehouse']);
    expect(unsupported('Data as of 2026-10-20T23:14:45.122Z; scored 2026-10-19; at 23:14 UTC.', [result], 'q')).toEqual(['2026-10-20T23:14:45.122Z', '2026-10-19', '23:14']);
    expect(unsupported('63.4 points; 28.9 points; 64.', [result], 'q')).toEqual(['63.4', '28.9', '64']);
  });

  it('earlier answers are not a source: without tool results, a figure is unsupported', () => {
    expect(unsupported('B-02-03 still has 63.', [], 'And now?')).toEqual(['B-02-03', '63']);
  });
});
