// Bin codes look like A-01-03: aisle A, rack 1, position 3 (D-006). Rack and
// position are numbers; the leading zeros belong to the code format only.

export function formatBinCode(aisle: string, rack: number, position: number): string {
  return `${aisle}-${twoDigits(rack)}-${twoDigits(position)}`;
}

// What a user types or scans: ' a-01-03 ' → 'A-01-03'. Codes never contain
// whitespace, so all of it is removed.
export function normalizeBinCode(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}
