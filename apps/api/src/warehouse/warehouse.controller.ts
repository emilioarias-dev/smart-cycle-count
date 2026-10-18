import { Controller, Get } from '@nestjs/common';
import { type WarehouseLayout, WarehouseService } from './warehouse.service.js';

@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @Get()
  layout(): Promise<WarehouseLayout> {
    return this.warehouseService.layout();
  }
}
