import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { type RecomputeSummary, recomputeScores } from '../scoring/recompute.js';

@Injectable()
export class ScoresService {
  constructor(private readonly prisma: PrismaService) {}

  // The recompute button scores every bin for the current time (D-010).
  recomputeNow(): Promise<RecomputeSummary> {
    return recomputeScores(this.prisma, new Date());
  }
}
