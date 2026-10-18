import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { type ScoreSummary, scoreSummary } from '../scoring/presenter.js';

export type WarehouseLayout = {
  aisles: {
    aisle: string;
    racks: {
      rack: number;
      bins: {
        code: string;
        position: number;
        palletCount: number;
        lastAuditedAt: Date | null;
        score: ScoreSummary | null;
      }[];
    }[];
  }[];
};

@Injectable()
export class WarehouseService {
  constructor(private readonly prisma: PrismaService) {}

  // Aisles → racks → bins, ordered by location fields, not by code (D-006).
  async layout(): Promise<WarehouseLayout> {
    const bins = await this.prisma.bin.findMany({
      orderBy: [{ aisle: 'asc' }, { rack: 'asc' }, { position: 'asc' }],
      select: {
        code: true,
        aisle: true,
        rack: true,
        position: true,
        lastAuditedAt: true,
        score: true,
        _count: { select: { pallets: true } },
      },
    });

    const aisles: WarehouseLayout['aisles'] = [];
    for (const bin of bins) {
      let aisle = aisles.at(-1);
      if (aisle?.aisle !== bin.aisle) {
        aisle = { aisle: bin.aisle, racks: [] };
        aisles.push(aisle);
      }
      let rack = aisle.racks.at(-1);
      if (rack?.rack !== bin.rack) {
        rack = { rack: bin.rack, bins: [] };
        aisle.racks.push(rack);
      }
      rack.bins.push({
        code: bin.code,
        position: bin.position,
        palletCount: bin._count.pallets,
        lastAuditedAt: bin.lastAuditedAt,
        score: scoreSummary(bin.score),
      });
    }
    return { aisles };
  }
}
