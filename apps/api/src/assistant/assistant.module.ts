import { Module } from '@nestjs/common';
import { BinsModule } from '../bins/bins.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AssistantController } from './assistant.controller.js';
import { AssistantService } from './assistant.service.js';
import { AssistantTools } from './tools.js';

@Module({
  imports: [PrismaModule, BinsModule],
  controllers: [AssistantController],
  providers: [AssistantService, AssistantTools],
})
export class AssistantModule {}
