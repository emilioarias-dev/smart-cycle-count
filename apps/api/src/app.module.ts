import { Module } from '@nestjs/common';
import { BinsModule } from './bins/bins.module.js';
import { ScoresModule } from './scores/scores.module.js';
import { WarehouseModule } from './warehouse/warehouse.module.js';

@Module({
  imports: [BinsModule, WarehouseModule, ScoresModule],
})
export class AppModule {}
