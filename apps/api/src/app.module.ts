import { Module } from '@nestjs/common';
import { BinsModule } from './bins/bins.module.js';
import { WarehouseModule } from './warehouse/warehouse.module.js';

@Module({
  imports: [BinsModule, WarehouseModule],
})
export class AppModule {}
