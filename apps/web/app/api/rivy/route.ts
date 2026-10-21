import { type RivyExchange, askRivy } from '../../../lib/api';

// Rivy's questions come here, not through a Server Action: Next.js runs a
// client's Server Actions one after another, so a slow answer from Gemini
// held back Create plan, Recompute and counts (D-018). This handler only
// forwards to the API (POST /assistant/ask); the key, tools, limits and
// checks stay there.
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { question?: unknown; history?: unknown } | null;
  if (!body || typeof body.question !== 'string' || !Array.isArray(body.history)) {
    return Response.json({ status: 'error', code: 'INVALID_QUESTION', message: 'Type a question.', retryable: false });
  }
  return Response.json(await askRivy(body.question, body.history as RivyExchange[]));
}
