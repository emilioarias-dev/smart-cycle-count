import { Body, Controller, HttpCode, HttpException, Post } from '@nestjs/common';
import { AskError, type AskErrorCode, type AskResult, AssistantService } from './assistant.service.js';

// Each failure has its own status and a message meant for the user; the rest
// of the app does not depend on Rivy.
const STATUS: Record<AskErrorCode, number> = {
  INVALID_QUESTION: 400,
  RATE_LIMITED: 429,
  QUOTA: 429,
  NOT_CONFIGURED: 503,
  UNAVAILABLE: 503,
  TIMEOUT: 504,
  AUTH: 502,
  BLOCKED: 502,
  MODEL_ERROR: 502,
  LIMIT: 502,
};

@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  // Body: { question, history: [{ question, answer }] } (last 6 exchanges).
  @Post('ask')
  @HttpCode(200)
  async ask(@Body() body: unknown): Promise<AskResult> {
    try {
      return await this.assistant.ask(body);
    } catch (error) {
      if (error instanceof AskError) {
        const status = STATUS[error.code];
        throw new HttpException(
          { statusCode: status, code: error.code, message: error.message, retryable: !['INVALID_QUESTION', 'NOT_CONFIGURED', 'AUTH'].includes(error.code), retryAfterSeconds: error.retryAfterSeconds },
          status,
        );
      }
      throw error;
    }
  }
}
