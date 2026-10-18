const DAY = 86_400_000;

// Dates are shown as UTC calendar days (the data is stored in UTC, D-009),
// with how long ago they were.
export function auditLabel(lastAuditedAt: string | null, now: Date = new Date()): string {
  if (lastAuditedAt === null) {
    return 'Never audited';
  }
  const date = new Date(lastAuditedAt);
  const days = Math.floor((now.getTime() - date.getTime()) / DAY);
  const ago = days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
  return `${date.toISOString().slice(0, 10)} (${ago})`;
}

export function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

// 1 pallet, 2 pallets; 1 box, 2 boxes. Enough for the units used here.
export function plural(count: number, singular: string): string {
  const pluralForm = /(s|x|ch|sh)$/.test(singular) ? `${singular}es` : `${singular}s`;
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
