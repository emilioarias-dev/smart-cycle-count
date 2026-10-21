// Server-side API client: the browser never calls the API directly and never
// sees API_BASE_URL (E-007). Every call returns one of three outcomes, so
// pages can show the data, a not-found state or an error state.

export type Priority = 'low' | 'medium' | 'high';

// Score, band and label all come from the API (D-010); the web only shows them.
export type ScoreSummary = { value: number; priority: Priority; label: string; reference: string };

type Factor = { weight: number; cap: number; input: number; factor: number; contribution: number };

export type CountResult = 'PASS' | 'FAIL';

export type ScoreDetail = ScoreSummary & {
  computedAt: string;
  formulaVersion: number;
  breakdown: {
    window: { from: string; to: string };
    factors: {
      age: Factor & { lastAuditedAt: string | null; neverAudited: boolean };
      activity: Factor;
      adjustments: Factor;
      // Formula v2 (D-012); absent in version 1 breakdowns.
      lastResult?: { weight: number; result: CountResult | null; countedAt: string | null; factor: number; contribution: number };
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
  count: { result: CountResult; countedAt: string } | null;
};

export type ProductRef = { sku: string; name: string; unit: string };
export type ExpectedLine = { palletCode: string; product: ProductRef; expectedQuantity: number };

export type CountSheet = {
  bin: { code: string };
  task: { id: number; planId: number; rank: number };
  inventoryVersion: number;
  lines: ExpectedLine[];
  products: ProductRef[];
};

// What the web sends; quantities typed as something other than a whole
// number are passed as typed, so the API rejects them with its message.
export type CountPayload = {
  inventoryVersion: number;
  lines: { palletCode: string; countedQuantity: unknown }[];
  unexpected: { code: string; quantity: unknown; productSku: string | null }[];
};

export type CountView = {
  id: number;
  taskId: number;
  bin: { code: string };
  result: CountResult;
  countedAt: string;
  inventoryVersion: number;
  lines: (ExpectedLine & { countedQuantity: number; variance: number })[];
  // product null: product unknown, quantity in declared units (D-012).
  unexpected: { code: string; quantity: number; product: ProductRef | null }[];
};

export type InventoryChange = { palletCode: string; change: 'added' | 'removed' | 'changed' };

// The outcomes of submitting a count (D-001, D-012).
export type CountOutcome =
  | { status: 'saved'; recovered: boolean; count: CountView; score: ScoreSummary | null }
  | {
      status: 'inventory-changed';
      message: string;
      inventoryVersion: number;
      lines: ExpectedLine[];
      changes: InventoryChange[];
      unexpectedNowExpected: string[];
    }
  | { status: 'already-counted'; message: string; count: CountView }
  | { status: 'rejected'; message: string }
  // No answer, or an unexpected one: the count may or may not be saved.
  | { status: 'unconfirmed'; message: string };

// One bar of the dashboard chart: the Top 5 of all bins in the D-011 order.
export type TopScore = { rank: number; binCode: string; score: ScoreDetail };

// Rivy (D-016): one answer, built by the API from its read-only tools.
export type RivyExchange = { question: string; answer: string };
type RivyScore = { value: number; band: string; scoreTime: string | null };
// Mirrors the API's Fact (apps/api/src/assistant/facts.ts).
export type RivyFact =
  | { kind: 'bin'; code: string; score: RivyScore | null; factors: { factor: string; input: string; points: number }[]; lastAudit: string | null; pallets: number; pendingPlan: number | null }
  | { kind: 'missing'; message: string }
  | { kind: 'compare'; first: string | null; decidedBy: string; bins: { code: string; score: RivyScore | null; forNewPlan: string }[] }
  | { kind: 'top'; bins: { rank: number; code: string; score: RivyScore }[] }
  | {
      kind: 'history';
      code: string;
      current: { value: number; scoreTime: string | null } | null;
      note: string | null;
      tasks: {
        planId: number;
        status: string;
        atSelection: RivyScore;
        count: { result: string; countedAt: string | null; lines: { pallet: string; sku: string; unit: string; expected: number; counted: number; variance: number }[]; unexpected: number } | null;
      }[];
    }
  | { kind: 'rules'; version: string };
export type RivyAnswer = {
  answer: string;
  facts: RivyFact[];
  withheld: string[] | null;
  references: { label: string; href: string }[];
  queriedAt: string | null;
  tools: { name: string; args: Record<string, unknown> }[];
  model: string;
  usage: { modelCalls: number; promptTokens: number; outputTokens: number; totalTokens: number };
  ms: number;
  truncated: boolean;
};
export type RivyOutcome = { status: 'ok'; data: RivyAnswer } | { status: 'error'; code: string; message: string; retryable: boolean };

// An error is `rejected` (the API said no: fix the input), `failed` (nothing
// was done: retrying is safe) or `unconfirmed` (a write was sent and no
// answer came back: it may or may not have been applied).
export type ErrorKind = 'rejected' | 'failed' | 'unconfirmed';
export type ApiResult<T> = { status: 'ok'; data: T } | { status: 'not-found' } | { status: 'error'; reason: string; kind?: ErrorKind };

// The demo scenario loaded (D-017); `scenario` is null when not recorded.
export type DemoDataset = { scenario: 'standard' | 'high-risk' | null; label: string; reference: string | null; loadedAt: string | null };

export function getDemoDataset(): Promise<ApiResult<DemoDataset>> {
  return getJson<DemoDataset>('/demo');
}

export function getWarehouse(): Promise<ApiResult<WarehouseLayout>> {
  return getJson<WarehouseLayout>('/warehouse');
}

export function getBin(code: string): Promise<ApiResult<BinDetail>> {
  return getJson<BinDetail>(`/bins/${encodeURIComponent(code)}`);
}

export function getTopScores(): Promise<ApiResult<TopScore[]>> {
  return getJson<TopScore[]>('/scores/top');
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

export function getCountSheet(code: string): Promise<ApiResult<CountSheet>> {
  return getJson<CountSheet>(`/bins/${encodeURIComponent(code)}/count-sheet`);
}

export async function submitCount(taskId: number, payload: CountPayload): Promise<CountOutcome> {
  const baseUrl = process.env.API_BASE_URL;
  if (!baseUrl) {
    return { status: 'rejected', message: 'API_BASE_URL is not set. Copy apps/web/.env.example to apps/web/.env.' };
  }
  const url = new URL(`/audit-tasks/${taskId}/count`, baseUrl);
  const unconfirmed = (why: string): CountOutcome => ({
    status: 'unconfirmed',
    message: `${why} It is not known whether the count was saved. Send the same count again: if it was saved, you will see the saved result.`,
  });
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error(`Request to ${url.href} failed:`, error);
    return unconfirmed('The API did not answer.');
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if ((response.status === 200 || response.status === 201) && body) {
    return { status: 'saved', ...(body as { recovered: boolean; count: CountView; score: ScoreSummary | null }) };
  }
  const message = typeof body?.message === 'string' ? body.message : `The API responded with HTTP ${response.status}.`;
  if (response.status === 409 && body?.code === 'INVENTORY_CHANGED') {
    return { status: 'inventory-changed', message, ...(body as Omit<Extract<CountOutcome, { status: 'inventory-changed' }>, 'status' | 'message'>) };
  }
  if (response.status === 409 && body?.code === 'TASK_ALREADY_COUNTED') {
    return { status: 'already-counted', message, count: body.count as CountView };
  }
  if (response.status === 400 || response.status === 404) {
    return { status: 'rejected', message };
  }
  console.error(`Request to ${url.href} returned HTTP ${response.status}`);
  return unconfirmed(`The API responded with HTTP ${response.status}.`);
}

// The API answers within its own 60 s limit; 75 s leaves room for the rest.
export async function askRivy(question: string, history: RivyExchange[]): Promise<RivyOutcome> {
  const baseUrl = process.env.API_BASE_URL;
  if (!baseUrl) {
    return { status: 'error', code: 'NOT_CONFIGURED', message: 'API_BASE_URL is not set. Copy apps/web/.env.example to apps/web/.env.', retryable: false };
  }
  const url = new URL('/assistant/ask', baseUrl);
  try {
    const response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(75_000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, history }),
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (response.ok && body) {
      return { status: 'ok', data: body as RivyAnswer };
    }
    return {
      status: 'error',
      code: typeof body?.code === 'string' ? body.code : `HTTP_${response.status}`,
      message: typeof body?.message === 'string' ? body.message : `The API responded with HTTP ${response.status}.`,
      retryable: body?.retryable !== false,
    };
  } catch (error) {
    console.error(`Request to ${url.href} failed:`, error);
    return { status: 'error', code: 'API_UNREACHABLE', message: 'The API did not answer. Check that it is running, then try again.', retryable: true };
  }
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
    // A refused connection sent nothing; a timeout or a cut connection after
    // a write was sent leaves its outcome unknown.
    const refused = (error as { cause?: { code?: string } }).cause?.code === 'ECONNREFUSED';
    if (method === 'POST' && !refused) {
      return { status: 'error', kind: 'unconfirmed', reason: 'The API did not answer, so it is not known whether this was done.' };
    }
    return {
      status: 'error',
      kind: 'failed',
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
      return { status: 'error', kind: 'rejected', reason: error.message };
    }
  }
  if (!response.ok) {
    console.error(`Request to ${url.href} returned HTTP ${response.status}`);
    return { status: 'error', kind: 'failed', reason: `The API responded with HTTP ${response.status}.` };
  }
  return { status: 'ok', data: (await response.json()) as T };
}
