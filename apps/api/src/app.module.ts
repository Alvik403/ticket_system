import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import {
  AuthController,
  OidcService,
  PublicCsrfGuard,
  SessionGuard,
} from './auth/auth';
import { AddPersonalDataConsentAt1735689600000 } from './migrations/1735689600000-AddPersonalDataConsentAt';
import { AddCheckInAndSlotHold1777900000000 } from './migrations/1777900000000-AddCheckInAndSlotHold';
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
import { RateLimitService } from './queue/rate-limit.service';
import { RetentionService } from './queue/retention.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<string>('DATABASE_URL'),
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
        migrations: [
          AddPersonalDataConsentAt1735689600000,
          AddCheckInAndSlotHold1777900000000,
        ],
        logging: false,
      }),
    }),
  ],
  controllers: [
    AppController,
    AuthController,
    PublicQueueController,
    EmployeeQueueController,
    AdminQueueController,
    AuditorQueueController,
  ],
  providers: [
    AppService,
    OidcService,
    SessionGuard,
    PublicCsrfGuard,
    QueueService,
    BookingService,
    RateLimitService,
    RetentionService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
