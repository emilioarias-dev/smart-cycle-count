import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module.js';
import { BinsModule } from './bins/bins.module.js';
import { CountsModule } from './counts/counts.module.js';
import { ScoresModule } from './scores/scores.module.js';
import { WarehouseModule } from './warehouse/warehouse.module.js';

@Module({
  imports: [BinsModule, WarehouseModule, ScoresModule, AuditModule, CountsModule],
})
export class AppModule {}
