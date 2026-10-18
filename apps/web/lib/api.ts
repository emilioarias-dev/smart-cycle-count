// Server-side API client: the browser never calls the API directly and never
// sees API_BASE_URL (E-007). Every call returns one of three outcomes, so
// pages can show the data, a not-found state or an error state.

export type WarehouseLayout = {
  aisles: {
    aisle: string;
    racks: {
      rack: number;
      bins: { code: string; position: number; palletCount: number; lastAuditedAt: string | null }[];
    }[];
  }[];
};

export type BinDetail = {
  code: string;
  aisle: string;
  rack: number;
  position: number;
  inventoryVersion: number;
  lastAuditedAt: string | null;
  pallets: { code: string; quantity: number; product: { sku: string; name: string; unit: string } }[];
};

export type ApiResult<T> = { status: 'ok'; data: T } | { status: 'not-found' } | { status: 'error'; reason: string };

export function getWarehouse(): Promise<ApiResult<WarehouseLayout>> {
  return getJson<WarehouseLayout>('/warehouse');
}

export function getBin(code: string): Promise<ApiResult<BinDetail>> {
  return getJson<BinDetail>(`/bins/${encodeURIComponent(code)}`);
}

async function getJson<T>(path: string): Promise<ApiResult<T>> {
  const baseUrl = process.env.API_BASE_URL;
  if (!baseUrl) {
    return { status: 'error', reason: 'API_BASE_URL is not set. Copy apps/web/.env.example to apps/web/.env.' };
  }

  const url = new URL(path, baseUrl);
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
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
  if (!response.ok) {
    console.error(`Request to ${url.href} returned HTTP ${response.status}`);
    return { status: 'error', reason: `The API responded with HTTP ${response.status}.` };
  }
  return { status: 'ok', data: (await response.json()) as T };
}
