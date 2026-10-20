import { Injectable } from '@nestjs/common';
import { type Content, type GeminiConfig, GeminiError, type GeminiErrorCode, type Part, type Usage, generateContent, geminiConfig } from './gemini.js';
import { AssistantTools, TOOL_DECLARATIONS, type ToolResult } from './tools.js';

// Rivy (D-016): one question, answered with at most two Gemini calls and two
// read-only tool runs. The conversation is not stored here: the browser sends
// its last exchanges with each question.

export const LIMITS = {
  questionChars: 500,
  exchanges: 6,
  // An earlier answer sent back as context is cut to this length.
  answerChars: 2000,
  modelCalls: 2,
  toolCalls: 2,
  outputTokens: 800,
} as const;

export type Exchange = { question: string; answer: string };
export type AskInput = { question: string; history: Exchange[] };
export type AskResult = {
  answer: string;
  references: { label: string; href: string }[];
  queriedAt: string | null;
  tools: { name: string; args: Record<string, unknown> }[];
  model: string;
  usage: { modelCalls: number; promptTokens: number; outputTokens: number; totalTokens: number };
  ms: number;
  truncated: boolean;
};

export type AskErrorCode = GeminiErrorCode | 'INVALID_QUESTION' | 'RATE_LIMITED' | 'LIMIT';
export class AskError extends Error {
  constructor(
    readonly code: AskErrorCode,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AskError';
  }
}

const SYSTEM = `You are Rivy, the read-only assistant of Smart Cycle Count, a warehouse cycle-count app. All data is synthetic demo data.
- Use the tools for every figure, date and link. Never invent or estimate numbers. If a tool says a bin does not exist or data is missing, say so plainly.
- Earlier answers in this conversation may be outdated: for current data, call the tools again.
- Keep three things apart: the CURRENT score (get_bin, with its score time), the score AT SELECTION copied when a plan selected the bin (get_bin_history), and a COUNT RESULT (PASS or FAIL, with its count time). No stored count means unknown, never PASS.
- Give the time references the tools return (score time, count time, "data as of" query time) as UTC dates and times.
- When you mention a bin or a page, write its link path exactly as a tool returned it (for example /bins/B-02-03 or /tasks).
- You cannot change anything: no plans, counts, recomputes, inventory moves or rule changes. If asked, say you are read-only and point to the Warehouse, Tasks or Count page.
- Answer in the language of the question (English if unclear). Keep bin codes, pallet codes, SKUs, units and the values PASS, FAIL, PENDING, DONE, High, Medium and Low exactly as given.
- Be brief: at most about 150 words, plain text, short lists if useful.`;

@Injectable()
export class AssistantService {
  // Model calls in the last minute, to stay under the free-tier rate limit.
  private readonly calls: number[] = [];

  constructor(private readonly tools: AssistantTools) {}

  async ask(input: unknown): Promise<AskResult> {
    const { question, history } = parseInput(input);
    const config = geminiConfig();
    const timeouts = { call: envMs('RIVY_CALL_TIMEOUT_MS', 30_000), total: envMs('RIVY_TOTAL_TIMEOUT_MS', 60_000) };
    const started = Date.now();
    const total = AbortSignal.timeout(timeouts.total);

    const contents: Content[] = [
      ...history.flatMap((e): Content[] => [
        { role: 'user', parts: [{ text: e.question }] },
        { role: 'model', parts: [{ text: e.answer.slice(0, LIMITS.answerChars) }] },
      ]),
      { role: 'user', parts: [{ text: question }] },
    ];
    const usage = { modelCalls: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0 };
    const used: AskResult['tools'] = [];
    const references = new Map<string, string>();
    let queriedAt: string | null = null;

    const call = async (toolMode: 'AUTO' | 'NONE') => {
      this.reserveCall(config);
      usage.modelCalls += 1;
      const reply = await generateContent(config, {
        systemInstruction: SYSTEM,
        contents,
        functionDeclarations: TOOL_DECLARATIONS,
        toolMode,
        maxOutputTokens: LIMITS.outputTokens,
        signal: AbortSignal.any([total, AbortSignal.timeout(timeouts.call)]),
      });
      addUsage(usage, reply.usage);
      return reply;
    };

    try {
      let reply = await call('AUTO');
      const calls = reply.content.parts.filter((p) => p.functionCall);
      if (calls.length > 0) {
        // The model's turn goes back exactly as received (thought signatures).
        contents.push(reply.content);
        const responses: Part[] = [];
        for (const [i, part] of calls.entries()) {
          const { name, args = {}, id } = part.functionCall!;
          let response: ToolResult;
          if (i < LIMITS.toolCalls) {
            used.push({ name, args });
            response = await this.tools.run(name, args);
            for (const link of response.links ?? []) {
              references.set(link.href, link.label);
            }
            if (typeof response.queriedAt === 'string') {
              queriedAt = response.queriedAt;
            }
          } else {
            response = { error: 'LIMIT', message: `Only ${LIMITS.toolCalls} tool calls per question.` };
          }
          responses.push({ functionResponse: { name, response, ...(id ? { id } : {}) } });
        }
        contents.push({ role: 'user', parts: responses });
        // The second and last call: no more tools, the model must answer.
        reply = await call('NONE');
      }
      const answer = textOf(reply.content.parts);
      if (!answer) {
        throw new AskError('LIMIT', `Rivy could not finish an answer within ${LIMITS.modelCalls} model calls. Try a more specific question.`);
      }
      return {
        answer,
        references: [...references].map(([href, label]) => ({ label, href })),
        queriedAt,
        tools: used,
        model: config.model,
        usage,
        ms: Date.now() - started,
        truncated: reply.finishReason === 'MAX_TOKENS',
      };
    } catch (error) {
      if (error instanceof GeminiError) {
        throw new AskError(error.code, error.message);
      }
      throw error;
    }
  }

  // Local guard under the project's requests-per-minute limit (GEMINI_RPM).
  private reserveCall(config: GeminiConfig): void {
    if (!config.apiKey && !config.keyViaProxy) {
      return;
    }
    const rpm = Number(process.env.GEMINI_RPM ?? 15);
    const now = Date.now();
    while (this.calls.length > 0 && now - this.calls[0] >= 60_000) {
      this.calls.shift();
    }
    if (this.calls.length >= rpm) {
      const wait = Math.ceil((60_000 - (now - this.calls[0])) / 1000);
      throw new AskError('RATE_LIMITED', `Rivy has reached ${rpm} Gemini requests in the last minute. Try again in ${wait} s.`, wait);
    }
    this.calls.push(now);
  }
}

function parseInput(input: unknown): AskInput {
  const body = (input ?? {}) as { question?: unknown; history?: unknown };
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) {
    throw new AskError('INVALID_QUESTION', 'Type a question.');
  }
  if (question.length > LIMITS.questionChars) {
    throw new AskError('INVALID_QUESTION', `Questions are limited to ${LIMITS.questionChars} characters.`);
  }
  const history = body.history ?? [];
  if (!Array.isArray(history) || history.length > LIMITS.exchanges) {
    throw new AskError('INVALID_QUESTION', `The conversation sent with a question is limited to the last ${LIMITS.exchanges} exchanges.`);
  }
  const exchanges = history.map((e) => e as Partial<Exchange>);
  if (!exchanges.every((e) => typeof e.question === 'string' && typeof e.answer === 'string' && e.question.length <= LIMITS.questionChars)) {
    throw new AskError('INVALID_QUESTION', 'Each earlier exchange needs a question (at most 500 characters) and an answer.');
  }
  return { question, history: exchanges as Exchange[] };
}

// The visible answer: text parts, without the model's thoughts.
function textOf(parts: Part[]): string {
  return parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('')
    .trim();
}

function addUsage(total: AskResult['usage'], usage: Usage) {
  total.promptTokens += usage.promptTokenCount ?? 0;
  total.outputTokens += (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  total.totalTokens += usage.totalTokenCount ?? 0;
}

function envMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
