import {
  Equals,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type {
  ClientCountry,
  EmployeeStatus,
  TicketStatus,
} from '../domain/entities';
import { TICKET_STATUSES } from '../domain/entities';

export class HoldSlotDto {
  @IsUUID() siteId!: string;
  @IsIn(['RF', 'CN']) country!: ClientCountry;
  @IsDateString() scheduledAt!: string;
}

export class RefreshHoldDto {
  @IsString() @MinLength(8) @MaxLength(64) holdId!: string;
}

export class LookupTicketDto {
  @IsString()
  @Matches(/^\d{1,8}$/, { message: 'Номер талона — только цифры' })
  number!: string;
  @IsString() @MinLength(6) @MaxLength(6) lookupCode!: string;
}

export class CreateTicketDto {
  @IsUUID() siteId!: string;
  @IsUUID() serviceTypeId!: string;
  @IsIn(['RF', 'CN']) country!: ClientCountry;
  @IsString() @MinLength(3) @MaxLength(200) fullName!: string;
  @IsDateString() departureDate!: string;
  @IsDateString() arrivalDate!: string;
  @IsDateString() scheduledAt!: string;
  @IsString() @MinLength(8) @MaxLength(64) holdId!: string;
  @IsString()
  @MinLength(11)
  @MaxLength(11)
  @Matches(/^\d{11}$/, { message: 'Некорректный номер телефона' })
  phone!: string;
  @IsBoolean()
  @Equals(true, {
    message: 'Необходимо согласие на обработку персональных данных',
  })
  personalDataConsent!: boolean;

  @IsOptional()
  @ValidateIf(
    (value: CreateTicketDto) =>
      value.website !== undefined && value.website !== '',
  )
  @MaxLength(0, { message: 'invalid' })
  website?: string;
}

export class RescheduleTicketDto {
  @IsDateString() scheduledAt!: string;
}

export class CreateBlockedSlotDto {
  @IsUUID() siteId!: string;
  @IsUUID() employeeId!: string;
  @IsString() @MaxLength(10) date!: string;
  @IsString() @MaxLength(5) startTime!: string;
  @IsString() @MaxLength(5) endTime!: string;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class EmployeeStatusDto {
  @IsIn(['AVAILABLE', 'PAUSED', 'OFFLINE'])
  status!: EmployeeStatus;
}

export class AssignmentActionDto {
  @IsIn(['CALL', 'START', 'COMPLETE', 'REQUEUE', 'NO_SHOW'])
  action!: 'CALL' | 'START' | 'COMPLETE' | 'REQUEUE' | 'NO_SHOW';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CreateWalkInTicketDto {
  @IsUUID() siteId!: string;
  @IsUUID() serviceTypeId!: string;
  @IsIn(['RF', 'CN']) country!: ClientCountry;
  @IsString() @MinLength(3) @MaxLength(200) fullName!: string;
  @IsDateString() scheduledAt!: string;
  @IsString()
  @MinLength(10)
  @MaxLength(20)
  @Matches(/^[\d+()\-\s]+$/, { message: 'Некорректный номер телефона' })
  phone!: string;
  @IsOptional()
  @IsDateString()
  departureDate?: string;
  @IsOptional()
  @IsDateString()
  arrivalDate?: string;
  @IsBoolean()
  @Equals(true, {
    message: 'Необходимо согласие на обработку персональных данных',
  })
  personalDataConsent!: boolean;

  @IsOptional()
  @ValidateIf(
    (value: CreateWalkInTicketDto) =>
      value.website !== undefined && value.website !== '',
  )
  @MaxLength(0, { message: 'invalid' })
  website?: string;
}

export class CreateDeskDto {
  @IsString()
  @MaxLength(120)
  label!: string;

  @IsUUID()
  siteId!: string;

  @IsIn(['RF', 'CN'])
  country!: ClientCountry;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  displayNumber?: number;
}

export class UpdateDeskDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsIn(['RF', 'CN'])
  country?: ClientCountry;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  displayNumber?: number | null;
}

export class AssignEmployeeDeskDto {
  @ValidateIf((value: AssignEmployeeDeskDto) => value.deskId !== null)
  @IsUUID()
  deskId!: string | null;
}

export class UpdateEmployeeCountryDto {
  @IsIn(['RF', 'CN'])
  country!: ClientCountry;
}

export class CreateManagerDto {
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  email?: string;
}

export class EmployeeSelfDeskDto {
  @ValidateIf((value: EmployeeSelfDeskDto) => value.deskId !== null)
  @IsUUID()
  deskId!: string | null;
}

export class SetTicketStatusDto {
  @IsIn(TICKET_STATUSES)
  status!: TicketStatus;
}
