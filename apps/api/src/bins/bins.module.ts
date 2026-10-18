import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BinsController } from './bins.controller.js';
import { BinsService } from './bins.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [BinsController],
  providers: [BinsService],
})
export class BinsModule {}
