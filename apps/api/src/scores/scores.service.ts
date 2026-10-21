import { Injectable } from '@nestjs/common';
import { comparePriority } from '../planning/selection.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ScoreBreakdown } from '../scoring/formula.js';
import { type ScoreDetail, scoreDetail } from '../scoring/presenter.js';
import { type RecomputeSummary, recomputeScoresNow } from '../scoring/recompute.js';

// The dashboard chart shows the five highest priorities of all bins.
export const TOP_SIZE = 5;

export type TopScore = { rank: number; binCode: string; score: ScoreDetail };

@Injectable()
export class ScoresService {
  constructor(private readonly prisma: PrismaService) {}

  // The recompute button scores every bin for the current time (D-010),
  // taken once it has the scores lock.
  recomputeNow(): Promise<RecomputeSummary> {
    return recomputeScoresNow(this.prisma);
  }

  // The highest stored scores of all bins, pending tasks included, in the
  // D-011 order (the same comparison as plans, on the stored breakdowns).
  async top(): Promise<TopScore[]> {
    const bins = await this.prisma.bin.findMany({ where: { score: { isNot: null } }, select: { id: true, code: true, score: true } });
    return bins
      .map((bin) => ({
        binId: bin.id,
        code: bin.code,
        hasPendingTask: false,
        score: { value: bin.score!.score, breakdown: bin.score!.breakdown as unknown as ScoreBreakdown },
        stored: bin.score!,
      }))
      .sort(comparePriority)
      .slice(0, TOP_SIZE)
      .map((candidate, index) => ({ rank: index + 1, binCode: candidate.code, score: scoreDetail(candidate.stored)! }));
  }
}
