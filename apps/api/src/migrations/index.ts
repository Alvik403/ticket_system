import { CreateInitialSchema1700000000000 } from './1700000000000-CreateInitialSchema';
import { AddPersonalDataConsentAt1735689600000 } from './1735689600000-AddPersonalDataConsentAt';
import { AddCheckInAndSlotHold1777900000000 } from './1777900000000-AddCheckInAndSlotHold';
import { AddDepartureArrivalDates1778000000000 } from './1778000000000-AddDepartureArrivalDates';

export const appMigrations = [
  CreateInitialSchema1700000000000,
  AddPersonalDataConsentAt1735689600000,
  AddCheckInAndSlotHold1777900000000,
  AddDepartureArrivalDates1778000000000,
];
