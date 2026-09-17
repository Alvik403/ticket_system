import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPersonalDataConsentAt1735689600000 implements MigrationInterface {
  name = 'AddPersonalDataConsentAt1735689600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "personalDataConsentAt" TIMESTAMPTZ`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ticket" DROP COLUMN IF EXISTS "personalDataConsentAt"`,
    );
  }
}
