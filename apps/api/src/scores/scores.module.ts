import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ScoresController } from './scores.controller.js';
import { ScoresService } from './scores.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [ScoresController],
  providers: [ScoresService],
})
export class ScoresModule {}
