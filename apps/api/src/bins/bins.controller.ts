import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import type { Bin } from '../generated/prisma/client.js';
import { BinsService } from './bins.service.js';

@Controller('bins')
export class BinsController {
  constructor(private readonly binsService: BinsService) {}

  @Get(':code')
  async findByCode(@Param('code') code: string): Promise<Bin> {
    const bin = await this.binsService.findByCode(code);
    if (!bin) {
      throw new NotFoundException(`Bin ${code} not found`);
    }
    return bin;
  }
}
