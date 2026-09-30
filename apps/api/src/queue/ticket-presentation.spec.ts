import {
  clientShowsDesk,
  clientStatusLabel,
  kanbanColumnFor,
  managerAllowedStatuses,
  managerStatusOptions,
  managerStatusPickerOptions,
  staffStatusLabel,
  ticketKind,
  ticketKindLabel,
} from './ticket-presentation';

describe('ticket presentation', () => {
  it('detects walk-in vs booking', () => {
    expect(ticketKind(null)).toBe('walkIn');
    expect(ticketKind(undefined)).toBe('walkIn');
    expect(ticketKind('2026-09-30T08:00:00.000Z')).toBe('booking');
  });

  it('uses call wording only for walk-in', () => {
    expect(clientStatusLabel('CALLED', 'walkIn')).toBe('Вас вызывают');
    expect(clientStatusLabel('CALLED', 'booking')).toBe('Подойдите к столу');
    expect(clientStatusLabel('CHECKED_IN', 'booking')).toBe(
      'Ожидаете свободный стол',
    );
  });

  it('shows desk for booking at assigned without call', () => {
    expect(clientShowsDesk('ASSIGNED', 'booking')).toBe(true);
    expect(clientShowsDesk('ASSIGNED', 'walkIn')).toBe(false);
    expect(clientShowsDesk('CALLED', 'walkIn')).toBe(true);
  });

  it('places assigned booking on approach column', () => {
    const day = {
      start: new Date('2026-09-30T00:00:00.000Z'),
      end: new Date('2026-10-01T00:00:00.000Z'),
    };
    expect(
      kanbanColumnFor('ASSIGNED', 'booking', new Date('2026-09-30T08:00:00Z')),
    ).toBe('approach');
    expect(kanbanColumnFor('ASSIGNED', 'walkIn', null)).toBe('queue');
    expect(
      kanbanColumnFor(
        'BOOKED',
        'booking',
        new Date('2026-09-30T08:00:00Z'),
        day,
      ),
    ).toBe('booked');
    expect(kanbanColumnFor('CALLED', 'walkIn', null)).toBe('approach');
  });

  it('labels staff views by channel', () => {
    expect(staffStatusLabel('CHECKED_IN', 'walkIn')).toBe('В очереди');
    expect(staffStatusLabel('IN_SERVICE', 'walkIn')).toBe('Обработка');
    expect(staffStatusLabel('CHECKED_IN', 'booking')).toBe('В очереди');
  });

  it('exposes manager status sets per channel', () => {
    expect(ticketKindLabel('walkIn')).toBe('Живая очередь');
    expect(managerAllowedStatuses('walkIn')).toContain('CALLED');
    expect(managerAllowedStatuses('booking')).not.toContain('CALLED');
    expect(
      managerStatusOptions('walkIn').some((row) => row.value === 'CALLED'),
    ).toBe(true);
  });

  it('offers only call, processing, queue return, and no-show actions', () => {
    const queue = managerStatusPickerOptions('walkIn', 'CHECKED_IN').filter(
      (row) => !row.current,
    );
    expect(queue.map((row) => row.label)).toEqual(['Вызов', 'Не явился']);

    const called = managerStatusPickerOptions('walkIn', 'CALLED').filter(
      (row) => !row.current,
    );
    expect(called.map((row) => row.label)).toEqual([
      'Обработка',
      'Вернуть в очередь',
      'Не явился',
    ]);

    const service = managerStatusPickerOptions('walkIn', 'IN_SERVICE').filter(
      (row) => !row.current,
    );
    expect(service.map((row) => row.label)).toEqual(['Готово']);
  });
});
