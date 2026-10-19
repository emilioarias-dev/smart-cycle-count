import { Injectable } from '@nestjs/common';
import { type CountSheet, openCountSheet } from '../counting/sheet.js';
import { type SubmittedCount, submitCount } from '../counting/submit.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class CountsService {
  constructor(private readonly prisma: PrismaService) {}

  openSheet(code: string): Promise<CountSheet> {
    return openCountSheet(this.prisma, code);
  }

  submit(taskId: number, body: unknown): Promise<SubmittedCount> {
    return submitCount(this.prisma, taskId, body);
  }
}
