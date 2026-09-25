import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInitialSchema1700000000000 implements MigrationInterface {
  name = 'CreateInitialSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "site" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "code" varchar NOT NULL,
        "name" varchar NOT NULL,
        "timezone" varchar NOT NULL DEFAULT 'Europe/Moscow',
        "active" boolean NOT NULL DEFAULT true
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "service_type" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar NOT NULL,
        "slaSeconds" integer NOT NULL DEFAULT 900,
        "active" boolean NOT NULL DEFAULT true,
        "siteId" uuid NOT NULL REFERENCES "site"("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "desk" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "label" varchar NOT NULL,
        "country" varchar NOT NULL DEFAULT 'RF',
        "active" boolean NOT NULL DEFAULT true,
        "siteId" uuid NOT NULL REFERENCES "site"("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "employee" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "oidcSubject" varchar NOT NULL,
        "displayName" varchar NOT NULL,
        "role" varchar NOT NULL DEFAULT 'EMPLOYEE',
        "status" varchar NOT NULL DEFAULT 'OFFLINE',
        "siteId" uuid REFERENCES "site"("id"),
        "deskId" uuid REFERENCES "desk"("id"),
        "country" varchar,
        "serviceTypeIds" text,
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ticket" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "number" varchar NOT NULL,
        "accessTokenHash" varchar NOT NULL,
        "lookupCodeHash" varchar,
        "status" varchar NOT NULL DEFAULT 'BOOKED',
        "callAttempts" integer NOT NULL DEFAULT 0,
        "priority" integer NOT NULL DEFAULT 0,
        "siteId" uuid NOT NULL REFERENCES "site"("id"),
        "serviceTypeId" uuid NOT NULL REFERENCES "service_type"("id"),
        "country" varchar,
        "fullName" varchar,
        "travelHistory" text,
        "departureDate" date,
        "arrivalDate" date,
        "personalDataConsentAt" timestamptz,
        "scheduledAt" timestamptz,
        "checkedInAt" timestamptz,
        "durationMinutes" integer NOT NULL DEFAULT 10,
        "reservedDeskId" uuid REFERENCES "desk"("id"),
        "clientNotice" text,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "assignment" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "ticketId" uuid NOT NULL REFERENCES "ticket"("id"),
        "employeeId" uuid NOT NULL REFERENCES "employee"("id"),
        "deskId" uuid REFERENCES "desk"("id"),
        "active" boolean NOT NULL DEFAULT true,
        "assignedAt" timestamp NOT NULL DEFAULT now(),
        "calledAt" timestamptz,
        "startedAt" timestamptz,
        "completedAt" timestamptz
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "blocked_slot" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "siteId" uuid NOT NULL REFERENCES "site"("id"),
        "employeeId" uuid NOT NULL REFERENCES "employee"("id"),
        "date" date NOT NULL,
        "startTime" varchar(5) NOT NULL,
        "endTime" varchar(5) NOT NULL,
        "reason" varchar,
        "createdAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ticket_event" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "ticketId" varchar NOT NULL,
        "type" varchar NOT NULL,
        "data" jsonb NOT NULL DEFAULT '{}',
        "actorSubject" varchar,
        "occurredAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_event" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "action" varchar NOT NULL,
        "actorSubject" varchar NOT NULL,
        "targetId" varchar,
        "details" jsonb NOT NULL DEFAULT '{}',
        "occurredAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "shift" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "employeeId" uuid NOT NULL REFERENCES "employee"("id"),
        "startedAt" timestamp NOT NULL DEFAULT now(),
        "endedAt" timestamptz
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_site_code" ON "site" ("code")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_employee_oidcSubject" ON "employee" ("oidcSubject")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ticket_accessTokenHash" ON "ticket" ("accessTokenHash")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ticket_lookupCodeHash" ON "ticket" ("lookupCodeHash") WHERE "lookupCodeHash" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ticket_site_status_created" ON "ticket" ("siteId", "status", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ticket_site_scheduled" ON "ticket" ("siteId", "scheduledAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ticket_site_country_scheduled_status" ON "ticket" ("siteId", "country", "scheduledAt", "status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "one_active_slot_per_desk_time" ON "ticket" ("reservedDeskId", "scheduledAt") WHERE "reservedDeskId" IS NOT NULL AND "scheduledAt" IS NOT NULL AND "status" IN ('BOOKED','WAITING','CHECKED_IN','ASSIGNED','CALLED','IN_SERVICE','REQUEUED')`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "one_active_assignment_per_ticket" ON "assignment" ("ticketId") WHERE "active" = true`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "one_active_assignment_per_employee" ON "assignment" ("employeeId") WHERE "active" = true`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_assignment_ticket" ON "assignment" ("ticketId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_assignment_employee_active" ON "assignment" ("employeeId", "active")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ticket_event_ticket_occurred" ON "ticket_event" ("ticketId", "occurredAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_event_occurred" ON "audit_event" ("occurredAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_blocked_slot_site_date" ON "blocked_slot" ("siteId", "date")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "shift"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_event"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ticket_event"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "blocked_slot"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "assignment"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ticket"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "employee"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "desk"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_type"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "site"`);
  }
}
