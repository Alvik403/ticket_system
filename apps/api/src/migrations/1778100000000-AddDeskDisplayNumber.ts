import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeskDisplayNumber1778100000000 implements MigrationInterface {
  name = 'AddDeskDisplayNumber1778100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "desk" ADD COLUMN IF NOT EXISTS "displayNumber" integer`,
    );
    await queryRunner.query(
      `UPDATE "desk"
          SET "displayNumber" = CAST(substring(label from '([0-9]+)$') AS integer)
        WHERE "displayNumber" IS NULL
          AND label ~ '[0-9]+$'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "desk" DROP COLUMN IF EXISTS "displayNumber"`,
    );
  }
}
