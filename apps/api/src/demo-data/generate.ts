import type { MovementInput } from '../inventory/movements.js';
import { type BinLocation, PRODUCTS, warehouseLayout } from './catalog.js';
import { SeededRandom } from './random.js';

// Generates the demo warehouse as plain data (D-009). Nothing here touches the
// database: the reset applies the result through the movement function.
//
// Same generator version + seed + reference ⇒ same data. Any change to the
// logic below changes the data, so it must come with a new GENERATOR_VERSION.
export const GENERATOR_VERSION = 1;
export const DEFAULT_SEED = 20261018;

// Scenarios (D-017). `standard` is the original demo, unchanged. `high-risk`
// runs the same simulation with a few hotspot bins that are never audited,
// busier and more prone to adjustments, so that the unchanged formula puts
// them in the high band. Weights, caps and bands are not touched.
export const SCENARIOS = ['standard', 'high-risk'] as const;
export type Scenario = (typeof SCENARIOS)[number];
export const SCENARIO_LABEL: Record<Scenario, string> = { standard: 'Original demo', 'high-risk': 'High-risk demo' };
const HOTSPOTS = 4;
const HOTSPOT_WEIGHT = 24;
const HOTSPOT_ADJUSTMENT_WEIGHT = 30;

const SECOND = 1000;
const DAY = 86_400 * SECOND;
export const ACTIVITY_DAYS = 30;
export const OPENING_STOCK_DAYS = 60;

const MAX_PALLETS_PER_BIN = 4;
// Candidate activity events over the last 30 days. A candidate that is not
// possible at its moment (for example a pick from an empty warehouse) is
// skipped, never replaced by an artificial event.
const ACTIVITY_SLOTS = 420;

type Profile = 'busy' | 'normal' | 'quiet';
const PROFILE_WEIGHT: Record<Profile, number> = { busy: 6, normal: 2, quiet: 0.5 };
const OPENING_PALLETS: Record<Profile, [number, number]> = { busy: [2, 4], normal: [1, 3], quiet: [0, 2] };

export type DemoProduct = { sku: string; name: string; unit: string };
export type DemoBin = BinLocation & { lastAuditedAt: Date | null };
export type DemoData = {
  generatorVersion: number;
  scenario: Scenario;
  seed: number;
  reference: Date;
  products: DemoProduct[];
  bins: DemoBin[];
  // In application order: chronological, ties keep generation order.
  movements: MovementInput[];
};

export function generateDemoData(options: { reference: Date; seed?: number; scenario?: Scenario }): DemoData {
  const { reference } = options;
  const scenario = options.scenario ?? 'standard';
  const seed = options.seed ?? DEFAULT_SEED;
  const random = new SeededRandom(seed);
  const layout = warehouseLayout();
  const at = (secondsBefore: number) => new Date(reference.getTime() - secondsBefore * SECOND);

  // Uneven activity on purpose: busy, normal and quiet bins, a few bins prone
  // to adjustments and a few that start empty.
  const order = random.shuffle(layout.map((bin) => bin.code));
  const profile = new Map<string, Profile>(
    order.map((code, i) => [code, i < 6 ? 'busy' : i < 15 ? 'quiet' : 'normal']),
  );
  const startsEmpty = new Set(order.slice(6, 9));
  const adjustmentProne = new Set(random.shuffle(order).slice(0, 5));
  // Without random draws, so the standard scenario's sequence is unchanged.
  const hotspots = new Set(scenario === 'high-risk' ? order.slice(0, HOTSPOTS) : []);

  // Simulated antecedent only: no audit records or results exist (D-009).
  const bins: DemoBin[] = layout.map((bin) => {
    const lastAuditedAt = random.chance(1 / 3) ? null : at(random.int(2 * 86_400, 90 * 86_400));
    return { ...bin, lastAuditedAt: hotspots.has(bin.code) ? null : lastAuditedAt };
  });

  // Simulation state, used to only generate movements that are valid at the
  // moment they happen.
  const palletsInBin = new Map<string, string[]>(layout.map((bin) => [bin.code, []]));
  const quantity = new Map<string, number>();
  let palletCount = 0;
  const nextPalletCode = () => `P-${String(++palletCount).padStart(4, '0')}`;

  const putaway = (binCode: string, occurredAt: Date): MovementInput => {
    const product = random.pick(PRODUCTS);
    const palletCode = nextPalletCode();
    const units = random.int(...product.palletQuantity);
    palletsInBin.get(binCode)!.push(palletCode);
    quantity.set(palletCode, units);
    return { type: 'PUTAWAY', palletCode, productSku: product.sku, binCode, quantity: units, occurredAt };
  };
  const removeFromBin = (binCode: string, palletCode: string) => {
    const list = palletsInBin.get(binCode)!;
    list.splice(list.indexOf(palletCode), 1);
  };

  // Opening stock: putaways between 60 and 30 days before the reference.
  const opening: { occurredAt: Date; binCode: string }[] = [];
  for (const bin of layout) {
    const [min, max] = OPENING_PALLETS[profile.get(bin.code)!];
    const count = startsEmpty.has(bin.code) ? 0 : random.int(min, max);
    for (let i = 0; i < count; i++) {
      const secondsBefore = random.int(ACTIVITY_DAYS * 86_400 + 1, OPENING_STOCK_DAYS * 86_400);
      opening.push({ occurredAt: at(secondsBefore), binCode: bin.code });
    }
  }
  const movements: MovementInput[] = chronological(opening).map((event) => putaway(event.binCode, event.occurredAt));

  // Last 30 days of activity, strictly before the reference.
  const slots = Array.from({ length: ACTIVITY_SLOTS }, () => ({
    occurredAt: at(random.int(1, ACTIVITY_DAYS * 86_400)),
  }));
  const withPallets = () => layout.filter((bin) => palletsInBin.get(bin.code)!.length > 0);
  const withRoom = () => layout.filter((bin) => palletsInBin.get(bin.code)!.length < MAX_PALLETS_PER_BIN);
  const byProfile = (bin: BinLocation) => (hotspots.has(bin.code) ? HOTSPOT_WEIGHT : PROFILE_WEIGHT[profile.get(bin.code)!]);

  for (const { occurredAt } of chronological(slots)) {
    const kind = random.weighted(
      [
        ['PICK', 55],
        ['PUTAWAY', 15],
        ['MOVE', 15],
        ['ADJUSTMENT', 10],
      ] as const,
      ([, weight]) => weight,
    )[0];

    if (kind === 'PUTAWAY') {
      const candidates = withRoom();
      if (candidates.length > 0) {
        movements.push(putaway(random.weighted(candidates, byProfile).code, occurredAt));
      }
      continue;
    }

    const sources = withPallets();
    if (sources.length === 0) {
      continue;
    }

    if (kind === 'PICK') {
      const bin = random.weighted(sources, byProfile);
      const palletCode = random.pick(palletsInBin.get(bin.code)!);
      const available = quantity.get(palletCode)!;
      const units = random.chance(0.15) ? available : random.int(1, Math.max(1, Math.ceil(available * 0.35)));
      quantity.set(palletCode, available - units);
      if (available === units) {
        removeFromBin(bin.code, palletCode);
      }
      movements.push({ type: 'PICK', palletCode, quantity: units, occurredAt });
    } else if (kind === 'MOVE') {
      const bin = random.weighted(sources, byProfile);
      const destinations = withRoom().filter((candidate) => candidate.code !== bin.code);
      if (destinations.length === 0) {
        continue;
      }
      const palletCode = random.pick(palletsInBin.get(bin.code)!);
      const destination = random.pick(destinations);
      removeFromBin(bin.code, palletCode);
      palletsInBin.get(destination.code)!.push(palletCode);
      movements.push({ type: 'MOVE', palletCode, toBinCode: destination.code, occurredAt });
    } else {
      const bin = random.weighted(sources, (candidate) => (hotspots.has(candidate.code) ? HOTSPOT_ADJUSTMENT_WEIGHT : adjustmentProne.has(candidate.code) ? 8 : 1));
      const palletCode = random.pick(palletsInBin.get(bin.code)!);
      const available = quantity.get(palletCode)!;
      const magnitude = random.int(1, 4);
      const delta = random.chance(0.6) ? -Math.min(magnitude, available) : magnitude;
      quantity.set(palletCode, available + delta);
      if (available + delta === 0) {
        removeFromBin(bin.code, palletCode);
      }
      movements.push({ type: 'ADJUSTMENT', palletCode, delta, occurredAt });
    }
  }

  return {
    generatorVersion: GENERATOR_VERSION,
    scenario,
    seed,
    reference,
    products: PRODUCTS.map(({ sku, name, unit }) => ({ sku, name, unit })),
    bins,
    movements,
  };
}

// Sorts by time; Array.prototype.sort is stable, so equal times keep their
// generation order (the stable tie-break).
function chronological<T extends { occurredAt: Date }>(events: T[]): T[] {
  return [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}
