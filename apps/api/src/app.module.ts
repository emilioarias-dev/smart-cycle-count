import { Module } from '@nestjs/common';
import { BinsModule } from './bins/bins.module.js';

@Module({
  imports: [BinsModule],
})
export class AppModule {}
