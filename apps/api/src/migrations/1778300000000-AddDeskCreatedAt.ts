import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeskCreatedAt1778300000000 implements MigrationInterface {
  name = 'AddDeskCreatedAt1778300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "desk" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "desk" DROP COLUMN IF EXISTS "createdAt"`,
    );
  }
}
