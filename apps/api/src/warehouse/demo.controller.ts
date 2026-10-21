import { Controller, Get } from '@nestjs/common';
import { SCENARIOS, SCENARIO_LABEL, type Scenario } from '../demo-data/generate.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type DemoDatasetView = {
  scenario: Scenario | null;
  label: string;
  generatorVersion: number | null;
  seed: number | null;
  reference: Date | null;
  loadedAt: Date | null;
};

// Which demo scenario is loaded (D-017), for the notice in the top bar.
@Controller('demo')
export class DemoController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async dataset(): Promise<DemoDatasetView> {
    const row = await this.prisma.demoDataset.findUnique({ where: { id: 1 } });
    if (!row) {
      return { scenario: null, label: 'Scenario not recorded', generatorVersion: null, seed: null, reference: null, loadedAt: null };
    }
    const scenario = (SCENARIOS as readonly string[]).includes(row.scenario) ? (row.scenario as Scenario) : null;
    return {
      scenario,
      label: scenario ? SCENARIO_LABEL[scenario] : `Unknown scenario "${row.scenario}"`,
      generatorVersion: row.generatorVersion,
      seed: row.seed,
      reference: row.referenceAt,
      loadedAt: row.loadedAt,
    };
  }
}
