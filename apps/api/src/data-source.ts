import { DataSource } from 'typeorm';
import {
  Assignment,
  AuditEvent,
  BlockedSlot,
  Desk,
  Employee,
  ServiceType,
  Shift,
  Site,
  Ticket,
  TicketEvent,
} from './domain/entities';
import { postgresConnectionUrl } from './http/connection-urls';
import { appMigrations } from './migrations';

export default new DataSource({
  type: 'postgres',
  url: postgresConnectionUrl(
    process.env.DATABASE_URL,
    process.env.POSTGRES_PASSWORD,
    process.env.POSTGRES_HOST,
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
  migrations: appMigrations,
});
