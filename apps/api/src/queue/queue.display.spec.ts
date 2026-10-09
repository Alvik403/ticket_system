import {
  boardColumnFor,
  boardCountryLabel,
  boardFullName,
  buildPublicBoardColumns,
  deskNumberFrom,
  formatBoardSlotTime,
  lastNameFromFullName,
} from './queue.display';

describe('queue display helpers', () => {
  it('takes the surname as the first word of the full name', () => {
    expect(lastNameFromFullName('Иванов Иван Иванович')).toBe('Иванов');
    expect(lastNameFromFullName('  Ли  ')).toBe('Ли');
    expect(lastNameFromFullName('')).toBe('—');
    expect(lastNameFromFullName(undefined)).toBe('—');
  });

  it('formats board labels', () => {
    expect(boardFullName('Иванов Иван')).toBe('Иванов Иван');
    expect(boardCountryLabel('RF')).toBe('РФ');
    expect(boardCountryLabel('CN')).toBe('Заграничная');
    expect(
      formatBoardSlotTime(new Date('2026-09-30T07:00:00.000Z')),
    ).toMatch(/\d{2}:\d{2}/);
  });

  it('prefers an explicit desk number over the label', () => {
    expect(deskNumberFrom({ displayNumber: 7, label: 'Стол РФ-1' })).toBe(7);
    expect(deskNumberFrom({ displayNumber: null, label: 'Стол РФ-2' })).toBe(2);
    expect(deskNumberFrom({ label: 'Стол Заграничная' })).toBe(null);
  });

  it('maps live statuses onto board columns', () => {
    expect(boardColumnFor('BOOKED')).toBe('booked');
    expect(boardColumnFor('CHECKED_IN')).toBe(null);
    expect(boardColumnFor('CALLED')).toBe('approach');
    expect(boardColumnFor('IN_SERVICE')).toBe('approach');
    expect(boardColumnFor('COMPLETED')).toBe(null);
  });

  it('builds a kanban and shows the desk only in the approach column', () => {
    const dayStart = new Date('2026-09-29T00:00:00.000Z');
    const dayEnd = new Date('2026-09-30T00:00:00.000Z');
    const now = new Date('2026-09-29T08:30:00.000Z').getTime();
    const columns = buildPublicBoardColumns(
      [
        {
          number: 'MAIN-001',
          status: 'BOOKED',
          fullName: 'Петров Пётр',
          country: 'RF',
          scheduledAt: new Date('2026-09-29T08:00:00.000Z'),
        },
        {
          number: 'MAIN-098',
          status: 'BOOKED',
          fullName: 'Опоздавший',
          country: 'RF',
          scheduledAt: new Date('2026-09-29T07:00:00.000Z'),
        },
        {
          number: 'MAIN-099',
          status: 'BOOKED',
          fullName: 'Завтрашний',
          country: 'RF',
          scheduledAt: new Date('2026-10-01T08:00:00.000Z'),
        },
        {
          number: 'MAIN-002',
          status: 'CHECKED_IN',
          fullName: 'Сидоров Сидор',
          country: 'CN',
          desk: { displayNumber: 4, label: 'Стол РФ-4' },
        },
        {
          number: 'MAIN-003',
          status: 'CALLED',
          fullName: 'Иванов Иван',
          country: 'RF',
          desk: { displayNumber: 2, label: 'Стол РФ-2' },
        },
      ],
      { start: dayStart, end: dayEnd },
      now,
    );

    expect(columns.find((column) => column.id === 'booked')?.tickets).toEqual([
      {
        number: 'MAIN-001',
        fullName: 'Петров Пётр',
        countryLabel: 'РФ',
        scheduledTime: expect.any(String),
        deskNumber: null,
        kind: 'booking',
      },
    ]);
    expect(columns.find((column) => column.id === 'queue')).toBeUndefined();
    expect(columns.some((column) => column.tickets.some((ticket) => ticket.number === 'MAIN-002'))).toBe(false);
    expect(columns.some((column) => column.tickets.some((ticket) => ticket.number === 'MAIN-098'))).toBe(false);
    expect(columns.find((column) => column.id === 'approach')?.tickets).toEqual([
      {
        number: 'MAIN-003',
        fullName: 'Иванов Иван',
        countryLabel: 'РФ',
        scheduledTime: null,
        deskNumber: 2,
        kind: 'walkIn',
      },
    ]);

    const withAssignedBooking = buildPublicBoardColumns(
      [
        {
          number: 'MAIN-010',
          status: 'ASSIGNED',
          fullName: 'Записной',
          scheduledAt: new Date('2026-09-29T09:00:00.000Z'),
        },
        {
          number: 'MAIN-011',
          status: 'ASSIGNED',
          fullName: 'Живой',
          scheduledAt: null,
        },
      ],
      { start: dayStart, end: dayEnd },
      now,
    );
    expect(
      withAssignedBooking.find((column) => column.id === 'approach')?.tickets[0]
        ?.number,
    ).toBe('MAIN-010');
    expect(
      withAssignedBooking.some((column) =>
        column.tickets.some((ticket) => ticket.number === 'MAIN-011'),
      ),
    ).toBe(false);
  });
});
