import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTicketPhone1778200000000 implements MigrationInterface {
  name = 'AddTicketPhone1778200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "phone" varchar`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ticket" DROP COLUMN IF EXISTS "phone"`);
  }
}
