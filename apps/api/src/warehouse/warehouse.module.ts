import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DemoController } from './demo.controller.js';
import { WarehouseController } from './warehouse.controller.js';
import { WarehouseService } from './warehouse.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [WarehouseController, DemoController],
  providers: [WarehouseService],
})
export class WarehouseModule {}
