import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCheckInAndSlotHold1777900000000 implements MigrationInterface {
  name = 'AddCheckInAndSlotHold1777900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "lookupCodeHash" VARCHAR`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "checkedInAt" TIMESTAMPTZ`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ticket_lookupCodeHash" ON "ticket" ("lookupCodeHash") WHERE "lookupCodeHash" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "one_active_slot_per_desk_time" ON "ticket" ("reservedDeskId", "scheduledAt") WHERE "reservedDeskId" IS NOT NULL AND "scheduledAt" IS NOT NULL AND "status" IN ('BOOKED','WAITING','CHECKED_IN','ASSIGNED','CALLED','IN_SERVICE','REQUEUED')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "one_active_slot_per_desk_time"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ticket_lookupCodeHash"`);
    await queryRunner.query(
      `ALTER TABLE "ticket" DROP COLUMN IF EXISTS "checkedInAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket" DROP COLUMN IF EXISTS "lookupCodeHash"`,
    );
  }
}
