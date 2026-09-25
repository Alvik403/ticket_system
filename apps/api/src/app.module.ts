import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { HealthController } from './health.controller';
import {
  AuthController,
  OidcService,
  PublicCsrfGuard,
  SessionGuard,
} from './auth/auth';
import { KeycloakAdminService } from './auth/keycloak-admin.service';
import { AppThrottlerGuard } from './http/app-throttler.guard';
import { postgresConnectionUrl } from './http/connection-urls';
import { appMigrations } from './migrations';
import {
  BlockedSlot,
  Desk,
  Employee,
  ServiceType,
  Shift,
  Site,
  Ticket,
  TicketEvent,
  AuditEvent,
  Assignment,
} from './domain/entities';
import {
  AdminQueueController,
  AuditorQueueController,
  EmployeeQueueController,
  PublicQueueController,
} from './queue/queue.controller';
import { BookingService } from './queue/booking.service';
import { QueueService } from './queue/queue.service';
import { QueueUpdatesService } from './queue/queue-updates.service';
import { RateLimitService } from './queue/rate-limit.service';
import { RetentionService } from './queue/retention.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 3_000 }]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: postgresConnectionUrl(
          config.get<string>('DATABASE_URL'),
          config.get<string>('POSTGRES_PASSWORD'),
          config.get<string>('POSTGRES_HOST'),
        ),
        entities: [
          Site,
          ServiceType,
          Desk,
          Employee,
          Ticket,
          Assignment,
          TicketEvent,
          AuditEvent,
          BlockedSlot,
          Shift,
        ],
        synchronize: config.get('DB_SYNCHRONIZE', 'false') === 'true',
        migrationsRun: config.get('DB_SYNCHRONIZE', 'false') !== 'true',
        migrations: appMigrations,
        extra: {
          max: 10,
          connectionTimeoutMillis: 5_000,
          statement_timeout: 15_000,
          query_timeout: 20_000,
        },
        logging: false,
      }),
    }),
  ],
  controllers: [
    AppController,
    HealthController,
    AuthController,
    PublicQueueController,
    EmployeeQueueController,
    AdminQueueController,
    AuditorQueueController,
  ],
  providers: [
    OidcService,
    SessionGuard,
    PublicCsrfGuard,
    QueueService,
    BookingService,
    RateLimitService,
    RetentionService,
    KeycloakAdminService,
    QueueUpdatesService,
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule {}
