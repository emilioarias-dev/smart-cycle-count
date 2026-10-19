import { Controller, HttpCode, Post } from '@nestjs/common';
import type { RecomputeSummary } from '../scoring/recompute.js';
import { ScoresService } from './scores.service.js';

@Controller('scores')
export class ScoresController {
  constructor(private readonly scoresService: ScoresService) {}

  @Post('recompute')
  @HttpCode(200)
  recompute(): Promise<RecomputeSummary> {
    return this.scoresService.recomputeNow();
  }
}
