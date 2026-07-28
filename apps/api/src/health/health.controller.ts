import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';

import { PrismaHealthIndicator } from './prisma.health';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly prisma: PrismaHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.prisma.isHealthy('database'),
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),
    ]);
  }
}
