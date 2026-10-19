import { Injectable } from '@nestjs/common';
import { type CreatedPlan, createPlan } from '../planning/create-plan.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PRIORITY_LABEL, type Priority } from '../scoring/formula.js';

export type TaskRow = {
  id: number;
  rank: number;
  status: 'PENDING' | 'DONE';
  createdAt: Date;
  completedAt: Date | null;
  bin: { code: string };
  plan: { id: number; requestedCount: number; createdCount: number; excluded: { pendingTask: number; noScore: number }; createdAt: Date };
  // The copy made when the plan was created (D-002), not the current score.
  score: { value: number; priority: Priority; label: string; reference: Date; computedAt: Date; formulaVersion: number };
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  createPlan(n: unknown): Promise<CreatedPlan> {
    return createPlan(this.prisma, n);
  }

  // Newest plan first, tasks in plan order.
  async listTasks(): Promise<TaskRow[]> {
    const tasks = await this.prisma.auditTask.findMany({
      orderBy: [{ planId: 'desc' }, { rank: 'asc' }],
      include: { bin: { select: { code: true } }, plan: { include: { _count: { select: { tasks: true } } } } },
    });
    return tasks.map((task) => {
      const priority = task.priority as Priority;
      return {
        id: task.id,
        rank: task.rank,
        status: task.status,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
        bin: task.bin,
        plan: {
          id: task.plan.id,
          requestedCount: task.plan.requestedCount,
          createdCount: task.plan._count.tasks,
          excluded: { pendingTask: task.plan.excludedPending, noScore: task.plan.excludedUnscored },
          createdAt: task.plan.createdAt,
        },
        score: {
          value: task.score,
          priority,
          label: PRIORITY_LABEL[priority],
          reference: task.scoreReferenceAt,
          computedAt: task.scoreComputedAt,
          formulaVersion: task.formulaVersion,
        },
      };
    });
  }
}
