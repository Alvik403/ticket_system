import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDepartureArrivalDates1778000000000 implements MigrationInterface {
  name = 'AddDepartureArrivalDates1778000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "departureDate" date`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "arrivalDate" date`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ticket" DROP COLUMN IF EXISTS "arrivalDate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket" DROP COLUMN IF EXISTS "departureDate"`,
    );
  }
}
