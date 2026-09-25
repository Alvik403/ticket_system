import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RateLimitService } from './queue/rate-limit.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get('ready')
  async ready() {
    await Promise.all([
      this.dataSource.query('SELECT 1'),
      this.rateLimit.ping(),
    ]);
    return { status: 'ok' };
  }
}
