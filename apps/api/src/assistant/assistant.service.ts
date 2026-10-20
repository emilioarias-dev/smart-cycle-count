import { Injectable, Logger } from '@nestjs/common';
import { type Content, type GeminiConfig, GeminiError, type GeminiErrorCode, type Part, type Usage, generateContent, geminiConfig } from './gemini.js';
import { unsupported } from './grounding.js';
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

export type AskErrorCode = GeminiErrorCode | 'INVALID_QUESTION' | 'RATE_LIMITED' | 'LIMIT' | 'UNSUPPORTED';
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
- Use the tools for every bin, figure, date and link, and state only what the tool results of THIS question contain. Never invent, estimate or compute new numbers. If a tool says a bin does not exist, or no tool returns what the question needs, say plainly that the app's records do not show it.
- For the bins with the highest scores or priority overall, use get_top_bins; never infer a ranking from other bins.
- Earlier answers in this conversation may be outdated and are not a source: for any figure, call the tools again.
- Keep three things apart: the CURRENT score (get_bin, with its score time), the score AT SELECTION copied when a plan selected the bin (get_bin_history), and a COUNT RESULT (PASS or FAIL, with its count time). No stored count means unknown, never PASS.
- Give the score time or count time a tool returns, as a UTC date and time, when it matters. Do not add a "data as of" line: the page shows the query time.
- When you mention a bin or a page, write its link path exactly as a tool returned it (for example /bins/B-02-03 or /tasks).
- You cannot change anything: no plans, counts, recomputes, inventory moves or rule changes. Only if asked to, say you are read-only and point to the Warehouse (/), Tasks (/tasks) or Count (/count) page.
- Answer in the language of the question (English if unclear). Keep bin codes, pallet codes, SKUs, units and the values PASS, FAIL, PENDING, DONE, High, Medium and Low exactly as given.
- Be brief: at most about 150 words, plain text, short lists if useful.`;

@Injectable()
export class AssistantService {
  private readonly logger = new Logger('Rivy');
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
    const results: ToolResult[] = [];
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
            results.push(response);
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
      // Nothing the tool results of this question do not contain is shown.
      const missing = unsupported(answer, results, question);
      if (missing.length > 0) {
        this.logger.warn(`Answer withheld; not in the records read (${used.map((t) => t.name).join(', ') || 'none'}): ${missing.join(', ')}`);
        throw new AskError(
          'UNSUPPORTED',
          `Rivy's answer was not shown: it mentioned ${list(missing)}, which the app's records read for this question (${used.map((t) => t.name).join(', ') || 'none'}) do not contain. Try again, or ask more specifically.`,
        );
      }
      return {
        answer,
        // A bin's page is a source only if the answer names that bin.
        references: [...references].filter(([href]) => !href.startsWith('/bins/') || answer.includes(href.slice('/bins/'.length))).map(([href, label]) => ({ label, href })),
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

function list(items: string[]): string {
  return items.length > 6 ? `${items.slice(0, 6).join(', ')} and ${items.length - 6} more` : items.join(', ');
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
