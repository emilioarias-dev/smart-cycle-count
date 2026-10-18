
// Shape of a bin as returned by the API (GET /bins/:code).
export type Bin = {
  id: number;
  code: string;
};

export type BinResult =
  | { status: 'ok'; bin: Bin }
  | { status: 'not-found'; code: string }
  | { status: 'error'; reason: string };

// Runs only on the Next.js server: the browser never calls the API directly
// and never sees API_BASE_URL (E-007).
export async function getBin(code: string): Promise<BinResult> {
  const baseUrl = process.env.API_BASE_URL;
  if (!baseUrl) {
    return {
      status: 'error',
      reason: 'API_BASE_URL is not set. Copy apps/web/.env.example to apps/web/.env.',
    };
  }

  const url = new URL(`/bins/${encodeURIComponent(code)}`, baseUrl);
  let response: Response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    console.error(`Request to ${url.href} failed:`, error);
    return {
      status: 'error',
      reason: 'The API could not be reached. Check that it is running and that API_BASE_URL is correct.',
    };
  }

  if (response.status === 404) {
    return { status: 'not-found', code };
  }
  if (!response.ok) {
    console.error(`Request to ${url.href} returned HTTP ${response.status}`);
    return { status: 'error', reason: `The API responded with HTTP ${response.status}.` };
  }
  return { status: 'ok', bin: (await response.json()) as Bin };
}
