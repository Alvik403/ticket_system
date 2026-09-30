import {
  compareManagerTickets,
  managerTicketVisibleInList,
} from './queue-dispatch';

describe('queue dispatch', () => {
  it('sorts tickets with a slot before legacy tickets without slot', () => {
    const withSlot = {
      scheduledAt: new Date('2026-09-30T10:00:00Z'),
      createdAt: new Date('2026-09-30T09:00:00Z'),
    };
    const noSlot = {
      scheduledAt: null,
      createdAt: new Date('2026-09-30T08:00:00Z'),
    };
    expect(compareManagerTickets(withSlot, noSlot)).toBeLessThan(0);
    expect(compareManagerTickets(noSlot, withSlot)).toBeGreaterThan(0);
  });

  it('orders by scheduled time then createdAt', () => {
    const early = {
      scheduledAt: new Date('2026-09-30T09:00:00Z'),
      createdAt: new Date(),
    };
    const late = {
      scheduledAt: new Date('2026-09-30T11:00:00Z'),
      createdAt: new Date(),
    };
    expect(compareManagerTickets(early, late)).toBeLessThan(0);
  });

  it('breaks ties on the same slot by createdAt', () => {
    const slot = new Date('2026-09-30T09:00:00Z');
    const first = { scheduledAt: slot, createdAt: new Date('2026-09-30T08:00:00Z') };
    const second = { scheduledAt: slot, createdAt: new Date('2026-09-30T08:30:00Z') };
    expect(compareManagerTickets(first, second)).toBeLessThan(0);
  });

  it('sorts active tickets before no-show and completed', () => {
    const early = new Date('2026-09-30T09:00:00Z');
    const late = new Date('2026-09-30T11:00:00Z');
    const active = {
      status: 'BOOKED',
      scheduledAt: late,
      createdAt: new Date('2026-09-30T08:00:00Z'),
    };
    const noShow = {
      status: 'NO_SHOW',
      scheduledAt: early,
      createdAt: new Date('2026-09-30T08:00:00Z'),
    };
    const completed = {
      status: 'COMPLETED',
      scheduledAt: early,
      createdAt: new Date('2026-09-30T07:00:00Z'),
    };
    expect(compareManagerTickets(active, noShow)).toBeLessThan(0);
    expect(compareManagerTickets(active, completed)).toBeLessThan(0);
    expect(compareManagerTickets(completed, noShow)).toBeLessThan(0);
  });

  it('sorts in-progress tickets before waiting bookings', () => {
    const slot = new Date('2026-09-30T09:00:00Z');
    const called = {
      status: 'CALLED',
      scheduledAt: slot,
      createdAt: new Date('2026-09-30T12:00:00Z'),
    };
    const waiting = {
      status: 'BOOKED',
      scheduledAt: slot,
      createdAt: new Date('2026-09-30T08:00:00Z'),
    };
    expect(compareManagerTickets(called, waiting)).toBeLessThan(0);
  });

  it('hides in-progress tickets from other managers', () => {
    const ticket = {
      status: 'CALLED',
      assignments: [{ active: true, employee: { id: 'mgr-a' } }],
    };
    expect(managerTicketVisibleInList(ticket, 'mgr-a')).toBe(true);
    expect(managerTicketVisibleInList(ticket, 'mgr-b')).toBe(false);
    expect(
      managerTicketVisibleInList({ status: 'BOOKED', assignments: [] }, 'mgr-b'),
    ).toBe(true);
  });
});
