// Server-side API client: the browser never calls the API directly and never
// sees API_BASE_URL (E-007). Every call returns one of three outcomes, so
// pages can show the data, a not-found state or an error state.

export type Priority = 'low' | 'medium' | 'high';

// Score, band and label all come from the API (D-010); the web only shows them.
export type ScoreSummary = { value: number; priority: Priority; label: string; reference: string };

type Factor = { weight: number; cap: number; input: number; factor: number; contribution: number };

export type ScoreDetail = ScoreSummary & {
  computedAt: string;
  formulaVersion: number;
  breakdown: {
    window: { from: string; to: string };
    factors: {
      age: Factor & { lastAuditedAt: string | null; neverAudited: boolean };
      activity: Factor;
      adjustments: Factor;
    };
    total: number;
    score: number;
  };
};

export type WarehouseLayout = {
  aisles: {
    aisle: string;
    racks: {
      rack: number;
      bins: {
        code: string;
        position: number;
        palletCount: number;
        lastAuditedAt: string | null;
        score: ScoreSummary | null;
      }[];
    }[];
  }[];
};

export type RecomputeSummary = {
  reference: string;
  computedAt: string;
  bins: number;
  byPriority: Record<Priority, number>;
};

export type BinDetail = {
  code: string;
  aisle: string;
  rack: number;
  position: number;
  inventoryVersion: number;
  lastAuditedAt: string | null;
  pallets: { code: string; quantity: number; product: { sku: string; name: string; unit: string } }[];
  score: ScoreDetail | null;
};

export type CreatedPlan = {
  plan: { id: number; requestedCount: number; createdCount: number; excluded: { pendingTask: number; noScore: number }; createdAt: string };
  tasks: { rank: number; binCode: string; score: ScoreSummary }[];
};

export type AuditTask = {
  id: number;
  rank: number;
  status: 'PENDING' | 'DONE';
  createdAt: string;
  completedAt: string | null;
  bin: { code: string };
  plan: { id: number; requestedCount: number; createdCount: number; excluded: { pendingTask: number; noScore: number }; createdAt: string };
  // The score copied when the plan was created (D-002).
  score: ScoreSummary & { computedAt: string; formulaVersion: number };
};

export type ApiResult<T> = { status: 'ok'; data: T } | { status: 'not-found' } | { status: 'error'; reason: string };

export function getWarehouse(): Promise<ApiResult<WarehouseLayout>> {
  return getJson<WarehouseLayout>('/warehouse');
}

export function getBin(code: string): Promise<ApiResult<BinDetail>> {
  return getJson<BinDetail>(`/bins/${encodeURIComponent(code)}`);
}

export function recomputeScores(): Promise<ApiResult<RecomputeSummary>> {
  return getJson<RecomputeSummary>('/scores/recompute', 'POST');
}

// N is passed as given; the API is the only place that validates it (D-011).
export function createPlan(n: unknown): Promise<ApiResult<CreatedPlan>> {
  return getJson<CreatedPlan>('/audit-plans', 'POST', { n });
}

export function getAuditTasks(): Promise<ApiResult<AuditTask[]>> {
  return getJson<AuditTask[]>('/audit-tasks');
}

async function getJson<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<ApiResult<T>> {
  const baseUrl = process.env.API_BASE_URL;
  if (!baseUrl) {
    return { status: 'error', reason: 'API_BASE_URL is not set. Copy apps/web/.env.example to apps/web/.env.' };
  }

  const url = new URL(path, baseUrl);
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      cache: 'no-store',
      signal: AbortSignal.timeout(method === 'POST' ? 30_000 : 5000),
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch (error) {
    console.error(`Request to ${url.href} failed:`, error);
    return {
      status: 'error',
      reason: 'The API could not be reached. Check that it is running and that API_BASE_URL is correct.',
    };
  }

  if (response.status === 404) {
    return { status: 'not-found' };
  }
  // 400 and 409 carry a message meant for the user (for example an invalid N).
  if (response.status === 400 || response.status === 409) {
    const error = (await response.json().catch(() => null)) as { message?: unknown } | null;
    if (typeof error?.message === 'string') {
      return { status: 'error', reason: error.message };
    }
  }
  if (!response.ok) {
    console.error(`Request to ${url.href} returned HTTP ${response.status}`);
    return { status: 'error', reason: `The API responded with HTTP ${response.status}.` };
  }
  return { status: 'ok', data: (await response.json()) as T };
}
