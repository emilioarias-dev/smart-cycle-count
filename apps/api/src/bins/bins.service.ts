import { Injectable } from '@nestjs/common';
import type { Bin } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class BinsService {
  constructor(private readonly prisma: PrismaService) {}

  findByCode(code: string): Promise<Bin | null> {
    return this.prisma.bin.findUnique({ where: { code } });
  }
}
