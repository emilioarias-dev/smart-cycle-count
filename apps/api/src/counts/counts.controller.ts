import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { CountSheet } from '../counting/sheet.js';
import type { SubmittedCount } from '../counting/submit.js';
import { CountError } from '../counting/submission.js';
import { CountsService } from './counts.service.js';

const NOT_FOUND = new Set(['TASK_NOT_FOUND', 'BIN_NOT_FOUND']);
const CONFLICT = new Set(['NO_PENDING_TASK', 'INVENTORY_CHANGED', 'TASK_ALREADY_COUNTED']);

@Controller()
export class CountsController {
  constructor(private readonly countsService: CountsService) {}

  // Opens a count: the bin's pending task, expected pallets and version.
  // 404 if the bin does not exist; 409 if it has no pending task.
  @Get('bins/:code/count-sheet')
  async openSheet(@Param('code') code: string): Promise<CountSheet> {
    return withErrors(() => this.countsService.openSheet(code));
  }

  // 201 with the new count; 200 with the stored count when this is an
  // identical retry ("recovered"); 400 for an invalid count; 404 for an
  // unknown task; 409 when the inventory changed (nothing saved) or the task
  // was already counted with other quantities.
  @Post('audit-tasks/:taskId/count')
  async submit(
    @Param('taskId') rawTaskId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SubmittedCount> {
    const taskId = /^\d{1,9}$/.test(rawTaskId) ? Number(rawTaskId) : Number.NaN;
    const result = await withErrors(() => {
      if (Number.isNaN(taskId)) {
        throw new CountError('TASK_NOT_FOUND', `Audit task ${rawTaskId} not found.`);
      }
      return this.countsService.submit(taskId, body);
    });
    response.status(result.recovered ? 200 : 201);
    return result;
  }
}

// Same shape as Nest's other errors, plus a machine-readable code and the
// details the client needs.
async function withErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof CountError)) {
      throw error;
    }
    const body = (statusCode: number, name: string) => ({ statusCode, error: name, code: error.code, message: error.message, ...error.details });
    if (NOT_FOUND.has(error.code)) {
      throw new NotFoundException(body(404, 'Not Found'));
    }
    if (CONFLICT.has(error.code)) {
      throw new ConflictException(body(409, 'Conflict'));
    }
    throw new BadRequestException(body(400, 'Bad Request'));
  }
}
