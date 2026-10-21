import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { InsightsController } from './insights.controller.js';
import { InsightsService } from './insights.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [InsightsController],
  providers: [InsightsService],
})
export class InsightsModule {}
