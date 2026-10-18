import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { normalizeBinCode } from '../inventory/bin-code.js';
import { type BinDetail, BinsService } from './bins.service.js';

@Controller('bins')
export class BinsController {
  constructor(private readonly binsService: BinsService) {}

  // Accepts the code as typed or scanned: ' a-01-03 ' finds A-01-03 (D-006).
  @Get(':code')
  async findByCode(@Param('code') rawCode: string): Promise<BinDetail> {
    const code = normalizeBinCode(rawCode);
    const bin = await this.binsService.findByCode(code);
    if (!bin) {
      throw new NotFoundException(`Bin ${code} not found`);
    }
    return bin;
  }
}
