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
import { AddPersonalDataConsentAt1735689600000 } from './migrations/1735689600000-AddPersonalDataConsentAt';
import { AddCheckInAndSlotHold1777900000000 } from './migrations/1777900000000-AddCheckInAndSlotHold';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
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
  migrations: [
    AddPersonalDataConsentAt1735689600000,
    AddCheckInAndSlotHold1777900000000,
  ],
});
