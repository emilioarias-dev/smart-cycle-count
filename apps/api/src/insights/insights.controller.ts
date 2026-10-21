import { Controller, Get } from '@nestjs/common';
import { type AuditInsights, InsightsService } from './insights.service.js';

@Controller('insights')
export class InsightsController {
  constructor(private readonly insightsService: InsightsService) {}

  // Reading it never recomputes scores or changes data.
  @Get('audits')
  audits(): Promise<AuditInsights> {
    return this.insightsService.audits();
  }
}
