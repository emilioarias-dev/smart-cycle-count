import type { MovementInput } from '../inventory/movements.js';
import { PRODUCTS, warehouseLayout } from './catalog.js';
import type { DemoBin, DemoData } from './generate.js';
import { SeededRandom } from './random.js';

// The high-risk scenario (D-017): a demo to illustrate every priority band,
// not a picture of a real warehouse. Each bin gets planned inputs (days since
// its simulated last audit, movements and adjustments in the 30 days before
// the reference) chosen so that the unchanged formula gives a spread of
// scores: 8 high, 12 medium, 10 low, different within each band. The inputs
// are then produced as ordinary, valid movements (putaways, picks and
// adjustments of real pallets) applied through the movement function.
//
// Same version + seed + reference ⇒ same data.
export const HIGH_RISK_VERSION = 2;

const SECOND = 1000;
const DAY = 86_400 * SECOND;
const WINDOW_DAYS = 30;
const MAX_PALLETS_PER_BIN = 4;

// Target score (for reading; the tests recompute it), days since the last
// audit (null: never audited), movements and adjustments in the window. Each
// total is at least 0.1 away from a .5, so rounding cannot flip it.
type Plan = { score: number; ageDays: number | null; activity: number; adjustments: number };
export const HIGH_RISK_PLAN: readonly Plan[] = [
  // High (70–100)
  { score: 75, ageDays: null, activity: 40, adjustments: 5 },
  { score: 74, ageDays: null, activity: 38, adjustments: 5 },
  { score: 73, ageDays: null, activity: 37, adjustments: 5 },
  { score: 73, ageDays: 85, activity: 40, adjustments: 5 },
  { score: 72, ageDays: null, activity: 35, adjustments: 5 },
  { score: 71, ageDays: null, activity: 40, adjustments: 4 },
  { score: 71, ageDays: null, activity: 33, adjustments: 5 },
  { score: 70, ageDays: null, activity: 38, adjustments: 4 },
  // Medium (40–69)
  { score: 67, ageDays: null, activity: 33, adjustments: 4 },
  { score: 64, ageDays: 88, activity: 30, adjustments: 4 },
  { score: 61, ageDays: 83, activity: 28, adjustments: 4 },
  { score: 58, ageDays: null, activity: 26, adjustments: 3 },
  { score: 55, ageDays: 85, activity: 24, adjustments: 3 },
  { score: 52, ageDays: 83, activity: 20, adjustments: 3 },
  { score: 50, ageDays: 85, activity: 22, adjustments: 2 },
  { score: 48, ageDays: 87, activity: 18, adjustments: 2 },
  { score: 46, ageDays: 73, activity: 16, adjustments: 3 },
  { score: 44, ageDays: 82, activity: 14, adjustments: 2 },
  { score: 42, ageDays: 80, activity: 12, adjustments: 2 },
  { score: 41, ageDays: null, activity: 11, adjustments: 1 },
  // Low (0–39)
  { score: 38, ageDays: 80, activity: 12, adjustments: 1 },
  { score: 35, ageDays: 75, activity: 10, adjustments: 1 },
  { score: 31, ageDays: 67, activity: 8, adjustments: 1 },
  { score: 27, ageDays: 63, activity: 10, adjustments: 0 },
  { score: 23, ageDays: 46, activity: 6, adjustments: 1 },
  { score: 19, ageDays: 46, activity: 6, adjustments: 0 },
  { score: 15, ageDays: 38, activity: 4, adjustments: 0 },
  { score: 11, ageDays: 26, activity: 4, adjustments: 0 },
  { score: 7, ageDays: 18, activity: 2, adjustments: 0 },
  { score: 4, ageDays: 13, activity: 0, adjustments: 0 },
];

type Event = { occurredAt: Date; kind: 'activity' | 'adjustment' };

export function generateHighRiskData(options: { reference: Date; seed: number }): DemoData {
  const { reference, seed } = options;
  const random = new SeededRandom(seed);
  const at = (msBefore: number) => new Date(reference.getTime() - msBefore);
  const layout = warehouseLayout();
  // Plans spread over the warehouse, not grouped by aisle.
  const plans = new Map(random.shuffle(layout.map((b) => b.code)).map((code, i) => [code, HIGH_RISK_PLAN[i]]));

  const bins: DemoBin[] = layout.map((bin) => {
    const { ageDays } = plans.get(bin.code)!;
    // Simulated antecedent only, as in the original demo (D-009).
    return { ...bin, lastAuditedAt: ageDays === null ? null : at(ageDays * DAY) };
  });

  let palletCount = 0;
  const nextPalletCode = () => `P-${String(++palletCount).padStart(4, '0')}`;
  const movements: MovementInput[] = [];
  const quantity = new Map<string, number>();

  for (const bin of layout) {
    const plan = plans.get(bin.code)!;
    const pallets: string[] = [];
    const putaway = (occurredAt: Date) => {
      const product = random.pick(PRODUCTS);
      const palletCode = nextPalletCode();
      const units = random.int(...product.palletQuantity);
      pallets.push(palletCode);
      quantity.set(palletCode, units);
      movements.push({ type: 'PUTAWAY', palletCode, productSku: product.sku, binCode: bin.code, quantity: units, occurredAt });
    };

    // Opening stock, before the window (31 to 60 days before the reference):
    // busier bins hold more pallets.
    const opening = plan.activity >= 20 ? 3 : plan.activity >= 6 ? 2 : 1;
    for (let i = 0; i < opening; i++) {
      putaway(at(random.int(31 * 86_400, 60 * 86_400) * SECOND));
    }

    // The planned movements, strictly inside the window and before the
    // reference, played in time order so every pick and adjustment is valid.
    const events: Event[] = [
      ...Array.from({ length: plan.activity }, () => ({ kind: 'activity' as const })),
      ...Array.from({ length: plan.adjustments }, () => ({ kind: 'adjustment' as const })),
    ]
      .map((e) => ({ ...e, occurredAt: at(random.int(60, WINDOW_DAYS * 86_400 - 60) * SECOND) }))
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    for (const event of events) {
      // A pallet that can lose units and stay in the bin.
      const stocked = pallets.filter((p) => quantity.get(p)! > 3);
      if (event.kind === 'adjustment') {
        const palletCode = random.pick(stocked.length > 0 ? stocked : pallets);
        const available = quantity.get(palletCode)!;
        const magnitude = random.int(1, 3);
        const delta = random.chance(0.6) && available > magnitude ? -magnitude : magnitude;
        quantity.set(palletCode, available + delta);
        movements.push({ type: 'ADJUSTMENT', palletCode, delta, occurredAt: event.occurredAt });
      } else if (stocked.length > 0 && (pallets.length >= MAX_PALLETS_PER_BIN || random.chance(0.8))) {
        const palletCode = random.pick(stocked);
        const units = random.int(1, Math.min(3, quantity.get(palletCode)! - 1));
        quantity.set(palletCode, quantity.get(palletCode)! - units);
        movements.push({ type: 'PICK', palletCode, quantity: units, occurredAt: event.occurredAt });
      } else {
        putaway(event.occurredAt);
      }
    }
  }

  // One log for the whole warehouse, in time order (stable for equal times).
  movements.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return {
    generatorVersion: HIGH_RISK_VERSION,
    scenario: 'high-risk',
    seed,
    reference,
    products: PRODUCTS.map(({ sku, name, unit }) => ({ sku, name, unit })),
    bins,
    movements,
  };
}
