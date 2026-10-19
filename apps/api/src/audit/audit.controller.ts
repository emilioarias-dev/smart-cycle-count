import { BadRequestException, Body, ConflictException, Controller, Get, Post } from '@nestjs/common';
import type { CreatedPlan } from '../planning/create-plan.js';
import { PlanError } from '../planning/selection.js';
import { AuditService, type TaskRow } from './audit.service.js';

@Controller()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  // Body: { "n": 1..30 } (optional, default 5). 201 with the plan and its
  // tasks; 400 for an invalid N; 409 when no plan can be created.
  @Post('audit-plans')
  async createPlan(@Body() body: unknown): Promise<CreatedPlan> {
    const n = body !== null && typeof body === 'object' ? (body as { n?: unknown }).n : undefined;
    try {
      return await this.auditService.createPlan(n);
    } catch (error) {
      if (error instanceof PlanError) {
        // Same shape as Nest's other errors, plus a machine-readable code.
        if (error.code === 'INVALID_N') {
          throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: error.code, message: error.message });
        }
        throw new ConflictException({ statusCode: 409, error: 'Conflict', code: error.code, message: error.message });
      }
      throw error;
    }
  }

  @Get('audit-tasks')
  listTasks(): Promise<TaskRow[]> {
    return this.auditService.listTasks();
  }
}
