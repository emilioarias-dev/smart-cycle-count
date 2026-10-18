// The reference time ("now" of the demo data) is captured once per run
// (D-009). SEED_NOW must carry an explicit zone so that it means the same
// instant on every machine: 2026-10-18T12:00:00Z or 2026-10-18T08:00:00-04:00.
const EXPLICIT_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export function resolveReference(seedNow: string | undefined, now: () => Date = () => new Date()): Date {
  if (seedNow === undefined || seedNow.trim() === '') {
    // Whole seconds keep the generated timestamps easy to read.
    return new Date(Math.floor(now().getTime() / 1000) * 1000);
  }
  const value = seedNow.trim();
  if (!EXPLICIT_ZONE.test(value)) {
    throw new Error(
      `SEED_NOW must be an ISO 8601 date-time with an explicit zone, such as 2026-10-18T12:00:00Z (got "${value}")`,
    );
  }
  const reference = new Date(value);
  if (Number.isNaN(reference.getTime())) {
    throw new Error(`SEED_NOW is not a valid date-time: "${value}"`);
  }
  return reference;
}
