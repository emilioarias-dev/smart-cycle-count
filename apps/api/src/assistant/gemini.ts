// Gemini through its REST API (generateContent), with Node's fetch: no SDK
// (D-016). Stateless: the caller sends the whole turn each time and keeps
// the model's content parts exactly as received, so Gemini 3's thought
// signatures go back unchanged.

export type Part = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
};
export type Content = { role: 'user' | 'model'; parts: Part[] };
export type Usage = { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };

export type GeminiRequest = {
  systemInstruction: string;
  contents: Content[];
  functionDeclarations: readonly unknown[];
  // NONE forbids function calls: the model must answer in text.
  toolMode: 'AUTO' | 'NONE';
  maxOutputTokens: number;
  signal: AbortSignal;
};
export type GeminiReply = { content: Content; finishReason: string | undefined; usage: Usage; ms: number };

export type GeminiErrorCode = 'NOT_CONFIGURED' | 'QUOTA' | 'UNAVAILABLE' | 'TIMEOUT' | 'AUTH' | 'BLOCKED' | 'MODEL_ERROR';
export class GeminiError extends Error {
  constructor(
    readonly code: GeminiErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

export type GeminiConfig = { apiKey: string | undefined; keyViaProxy: boolean; model: string; baseUrl: string };

export function geminiConfig(env = process.env): GeminiConfig {
  return {
    apiKey: env.GEMINI_API_KEY?.trim() || undefined,
    // Only for an environment whose outbound proxy adds the key header.
    keyViaProxy: env.GEMINI_KEY_VIA_PROXY === 'true',
    model: env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite',
    baseUrl: (env.GEMINI_API_BASE?.trim() || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, ''),
  };
}

export async function generateContent(config: GeminiConfig, request: GeminiRequest): Promise<GeminiReply> {
  if (!config.apiKey && !config.keyViaProxy) {
    throw new GeminiError('NOT_CONFIGURED', 'Rivy is not configured: set GEMINI_API_KEY in apps/api/.env and restart the API.');
  }
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/models/${encodeURIComponent(config.model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(config.apiKey ? { 'x-goog-api-key': config.apiKey } : {}) },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.systemInstruction }] },
        contents: request.contents,
        tools: [{ functionDeclarations: request.functionDeclarations }],
        toolConfig: { functionCallingConfig: { mode: request.toolMode } },
        generationConfig: { maxOutputTokens: request.maxOutputTokens },
      }),
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) {
      throw new GeminiError('TIMEOUT', 'Gemini did not answer in time.');
    }
    throw new GeminiError('UNAVAILABLE', `Gemini could not be reached (${(error as Error).message}).`);
  }
  const body = (await response.json().catch(() => null)) as Record<string, any> | null;
  if (!response.ok) {
    const status = body?.error?.status as string | undefined;
    const detail = String(body?.error?.message ?? `HTTP ${response.status}`).slice(0, 200);
    if (response.status === 429) {
      throw new GeminiError('QUOTA', `Gemini quota or rate limit reached (429${status ? ` ${status}` : ''}). Try again later.`, 429);
    }
    if (response.status === 401 || response.status === 403 || (response.status === 400 && /api key/i.test(detail))) {
      throw new GeminiError('AUTH', `Gemini refused the request (${response.status}): check GEMINI_API_KEY.`, response.status);
    }
    if (response.status >= 500) {
      throw new GeminiError('UNAVAILABLE', `Gemini is unavailable (${response.status}${status ? ` ${status}` : ''}): ${detail}`, response.status);
    }
    throw new GeminiError('MODEL_ERROR', `Gemini rejected the request (${response.status}): ${detail}`, response.status);
  }
  if (body?.promptFeedback?.blockReason) {
    throw new GeminiError('BLOCKED', `Gemini blocked the question (${body.promptFeedback.blockReason}).`);
  }
  const candidate = body?.candidates?.[0];
  if (!candidate?.content?.parts) {
    const reason = candidate?.finishReason as string | undefined;
    throw new GeminiError(reason && /SAFETY|BLOCK|PROHIBITED/.test(reason) ? 'BLOCKED' : 'MODEL_ERROR', `Gemini returned no answer${reason ? ` (${reason})` : ''}.`);
  }
  return { content: { role: 'model', parts: candidate.content.parts as Part[] }, finishReason: candidate.finishReason, usage: body?.usageMetadata ?? {}, ms: Date.now() - started };
}
