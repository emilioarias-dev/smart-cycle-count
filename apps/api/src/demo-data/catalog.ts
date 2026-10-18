import { formatBinCode } from '../inventory/bin-code.js';

// Fixed parts of the demo warehouse (D-006, D-007).

export const AISLES = ['A', 'B', 'C'] as const;
export const RACKS_PER_AISLE = 2;
export const POSITIONS_PER_RACK = 5;

export type BinLocation = { code: string; aisle: string; rack: number; position: number };

export function warehouseLayout(): BinLocation[] {
  const bins: BinLocation[] = [];
  for (const aisle of AISLES) {
    for (let rack = 1; rack <= RACKS_PER_AISLE; rack++) {
      for (let position = 1; position <= POSITIONS_PER_RACK; position++) {
        bins.push({ code: formatBinCode(aisle, rack, position), aisle, rack, position });
      }
    }
  }
  return bins;
}

// Each SKU is counted in its own unit; there are no conversions between units.
// `palletQuantity` is the range used when a new pallet arrives.
export type CatalogProduct = {
  sku: string;
  name: string;
  unit: string;
  palletQuantity: [number, number];
};

export const PRODUCTS: readonly CatalogProduct[] = [
  { sku: 'SKU-001', name: 'Bottled water 24 × 500 ml', unit: 'case', palletQuantity: [40, 80] },
  { sku: 'SKU-002', name: 'Sparkling water 12 × 1 l', unit: 'case', palletQuantity: [40, 70] },
  { sku: 'SKU-003', name: 'Orange juice 6 × 1 l', unit: 'case', palletQuantity: [50, 90] },
  { sku: 'SKU-004', name: 'Long-grain rice 25 kg', unit: 'bag', palletQuantity: [30, 40] },
  { sku: 'SKU-005', name: 'Wheat flour 25 kg', unit: 'bag', palletQuantity: [30, 40] },
  { sku: 'SKU-006', name: 'Granulated sugar 10 kg', unit: 'bag', palletQuantity: [50, 80] },
  { sku: 'SKU-007', name: 'Olive oil 5 l', unit: 'can', palletQuantity: [60, 100] },
  { sku: 'SKU-008', name: 'Paper towels, 6 rolls', unit: 'pack', palletQuantity: [40, 60] },
  { sku: 'SKU-009', name: 'Toilet paper, 24 rolls', unit: 'pack', palletQuantity: [30, 48] },
  { sku: 'SKU-010', name: 'Dish soap 12 × 750 ml', unit: 'case', palletQuantity: [40, 70] },
  { sku: 'SKU-011', name: 'Laundry detergent 4 kg', unit: 'box', palletQuantity: [50, 90] },
  { sku: 'SKU-012', name: 'Canned tomatoes 12 × 400 g', unit: 'case', palletQuantity: [60, 100] },
];
