import { normalizeBinCode } from '../inventory/bin-code.js';
import type { CountResult } from '../scoring/formula.js';

// What an operator submits for a count, validated and normalised without a
// database (D-003, D-012). The normalised form is also what makes two
// submissions "the same" for a retry.

export const MAX_QUANTITY = 1_000_000;
export const MAX_UNEXPECTED = 10;
export const MAX_CODE_LENGTH = 40;

export type CountErrorCode =
  | 'INVALID_COUNT'
  | 'LINES_MISMATCH'
  | 'UNEXPECTED_IS_EXPECTED'
  | 'UNKNOWN_PRODUCT'
  | 'TASK_NOT_FOUND'
  | 'BIN_NOT_FOUND'
  | 'NO_PENDING_TASK'
  | 'INVENTORY_CHANGED'
  | 'TASK_ALREADY_COUNTED';

export class CountError extends Error {
  constructor(
    readonly code: CountErrorCode,
    message: string,
    // Extra data for the client (current inventory, stored count).
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'CountError';
  }
}

export type CountSubmission = {
  // The bin version shown when the count was opened (D-001).
  inventoryVersion: number;
  // One line per expected pallet, sorted by pallet code.
  lines: { palletCode: string; countedQuantity: number }[];
  // Sorted by code. A null product means "product unknown": the quantity is
  // in units declared by the operator.
  unexpected: { code: string; quantity: number; productSku: string | null }[];
};

// Pallet codes follow the same rule as bin codes: whitespace removed, upper
// case (D-006, D-012).
export const normalizeCode = normalizeBinCode;

export function parseSubmission(body: unknown): CountSubmission {
  if (!isObject(body)) {
    throw invalid('The count must be a JSON object.');
  }
  const inventoryVersion = body.inventoryVersion;
  if (!Number.isInteger(inventoryVersion) || (inventoryVersion as number) < 0) {
    throw invalid('inventoryVersion must be the whole number shown when the count was opened.');
  }
  if (!Array.isArray(body.lines)) {
    throw invalid('lines must be a list with one entry per expected pallet.');
  }
  const lines = body.lines.map((line, index) => {
    if (!isObject(line)) {
      throw invalid(`Line ${index + 1} must be an object.`);
    }
    return {
      palletCode: code(line.palletCode, `Line ${index + 1}: pallet code`),
      countedQuantity: quantity(line.countedQuantity, 0, `Line ${index + 1}: counted quantity`),
    };
  });
  const unexpectedInput = body.unexpected ?? [];
  if (!Array.isArray(unexpectedInput)) {
    throw invalid('unexpected must be a list.');
  }
  if (unexpectedInput.length > MAX_UNEXPECTED) {
    throw invalid(`At most ${MAX_UNEXPECTED} unexpected pallets per count.`);
  }
  const unexpected = unexpectedInput.map((pallet, index) => {
    if (!isObject(pallet)) {
      throw invalid(`Unexpected pallet ${index + 1} must be an object.`);
    }
    const sku = pallet.productSku;
    if (sku !== undefined && sku !== null && typeof sku !== 'string') {
      throw invalid(`Unexpected pallet ${index + 1}: productSku must be a catalog SKU or null (product unknown).`);
    }
    return {
      code: code(pallet.code, `Unexpected pallet ${index + 1}: code`),
      quantity: quantity(pallet.quantity, 1, `Unexpected pallet ${index + 1}: quantity`),
      productSku: typeof sku === 'string' && sku.trim() !== '' ? sku.trim() : null,
    };
  });

  rejectDuplicates(lines.map((l) => l.palletCode), (c) => `Pallet ${c} appears in more than one line.`);
  rejectDuplicates(unexpected.map((u) => u.code), (c) => `Unexpected pallet ${c} is listed more than once.`);

  return {
    inventoryVersion: inventoryVersion as number,
    lines: lines.sort((a, b) => byText(a.palletCode, b.palletCode)),
    unexpected: unexpected.sort((a, b) => byText(a.code, b.code)),
  };
}

// PASS if and only if every expected pallet matches exactly and nothing
// unexpected was found (D-003).
export function deriveResult(lines: { expectedQuantity: number; countedQuantity: number }[], unexpectedCount: number): CountResult {
  return unexpectedCount === 0 && lines.every((l) => l.countedQuantity === l.expectedQuantity) ? 'PASS' : 'FAIL';
}

// The same normalised content gives the same text (D-012 retries).
export function canonical(submission: CountSubmission): string {
  return JSON.stringify([
    submission.inventoryVersion,
    submission.lines.map((l) => [l.palletCode, l.countedQuantity]),
    submission.unexpected.map((u) => [u.code, u.quantity, u.productSku]),
  ]);
}

export function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function code(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw invalid(`${label} is required.`);
  }
  const normalized = normalizeCode(value);
  if (normalized.length === 0 || normalized.length > MAX_CODE_LENGTH) {
    throw invalid(`${label} must have 1 to ${MAX_CODE_LENGTH} characters.`);
  }
  return normalized;
}

function quantity(value: unknown, min: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > MAX_QUANTITY) {
    throw invalid(`${label} must be a whole number from ${min} to ${MAX_QUANTITY}.`);
  }
  return value;
}

function rejectDuplicates(codes: string[], message: (code: string) => string): void {
  const seen = new Set<string>();
  for (const c of codes) {
    if (seen.has(c)) {
      throw invalid(message(c));
    }
    seen.add(c);
  }
}

function invalid(message: string): CountError {
  return new CountError('INVALID_COUNT', message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
