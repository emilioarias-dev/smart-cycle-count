import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CountsController } from './counts.controller.js';
import { CountsService } from './counts.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [CountsController],
  providers: [CountsService],
})
export class CountsModule {}
