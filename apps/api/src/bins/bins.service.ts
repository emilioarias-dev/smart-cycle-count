import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export type BinDetail = {
  code: string;
  aisle: string;
  rack: number;
  position: number;
  inventoryVersion: number;
  lastAuditedAt: Date | null;
  pallets: {
    code: string;
    quantity: number;
    product: { sku: string; name: string; unit: string };
  }[];
};

@Injectable()
export class BinsService {
  constructor(private readonly prisma: PrismaService) {}

  // Only pallets currently in the bin: a depleted pallet has no bin (D-007).
  async findByCode(code: string): Promise<BinDetail | null> {
    const bin = await this.prisma.bin.findUnique({
      where: { code },
      include: {
        pallets: {
          orderBy: { code: 'asc' },
          include: { product: { select: { sku: true, name: true, unit: true } } },
        },
      },
    });
    if (!bin) {
      return null;
    }
    return {
      code: bin.code,
      aisle: bin.aisle,
      rack: bin.rack,
      position: bin.position,
      inventoryVersion: bin.inventoryVersion,
      lastAuditedAt: bin.lastAuditedAt,
      pallets: bin.pallets.map(({ code: palletCode, quantity, product }) => ({ code: palletCode, quantity, product })),
    };
  }
}
