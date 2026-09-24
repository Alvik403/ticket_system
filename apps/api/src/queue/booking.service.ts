import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { DataSource, In, Not } from 'typeorm';
import { SLOT_HOLDING_STATUSES } from '../domain/entities';
import { zonedDateTime } from '../timezone';
import { RateLimitService } from './rate-limit.service';

import {
  AuditEvent,
  BlockedSlot,
  type ClientCountry,
  Desk,
  Employee,
  Site,
  Ticket,
} from '../domain/entities';

export const WORKDAY_START_MINUTES = 8 * 60;

export const WORKDAY_END_MINUTES = 17 * 60;

export const SLOT_DURATION: Record<ClientCountry, number> = {
  RF: 20,
  CN: 30,
};

const ACTIVE_SLOT_STATUSES = SLOT_HOLDING_STATUSES;

@Injectable()
export class BookingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly rateLimit: RateLimitService,
  ) {}

  durationFor(country: ClientCountry): number {
    return SLOT_DURATION[country];
  }

  getAvailableDates(count = 14): string[] {
    const dates: string[] = [];

    const today = this.formatDate(new Date());

    const cursor = this.slotToDate(today, '12:00');

    cursor.setDate(cursor.getDate() + 1);

    while (dates.length < count) {
      const day = cursor.getDay();

      if (day !== 0 && day !== 6) {
        dates.push(this.formatDate(cursor));
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    return dates;
  }

  generateSlotTimes(country: ClientCountry): string[] {
    const step = SLOT_DURATION[country];

    const slots: string[] = [];

    for (
      let minutes = WORKDAY_START_MINUTES;
      minutes + step <= WORKDAY_END_MINUTES;
      minutes += step
    ) {
      slots.push(this.minutesToTime(minutes));
    }

    return slots;
  }

  slotToDate(date: string, time: string, timeZone = 'Europe/Moscow'): Date {
    return zonedDateTime(date, time, timeZone);
  }

  async listAvailableSlots(
    siteId: string,
    date: string,
    country: ClientCountry,
    excludeTicketId?: string,
  ) {
    this.assertWeekday(date);
    const site = await this.dataSource.getRepository(Site).findOneBy({
      id: siteId,
      active: true,
    });
    const timeZone = site?.timezone ?? 'Europe/Moscow';
    const duration = this.durationFor(country);
    const candidates = this.generateSlotTimes(country);
    const now = Date.now();
    const desks = await this.dataSource.getRepository(Desk).find({
      where: { site: { id: siteId }, active: true, country },
    });
    const tickets = await this.dataSource.getRepository(Ticket).find({
      where: {
        site: { id: siteId },
        country,
        status: In([...ACTIVE_SLOT_STATUSES]),
        ...(excludeTicketId ? { id: Not(excludeTicketId) } : {}),
      },
      relations: { reservedDesk: true },
    });
    const blocks = await this.dataSource.getRepository(BlockedSlot).find({
      where: { site: { id: siteId }, date },
      relations: { employee: { desk: true } },
    });
    const heldSlots = await this.rateLimit.listHolds();

    return candidates.map((time) => {
      const scheduledAt = this.slotToDate(date, time, timeZone);
      const startMs = scheduledAt.getTime();
      const endMs = startMs + duration * 60_000;
      if (startMs <= now || !desks.length) {
        return { time, scheduledAt: scheduledAt.toISOString(), available: false };
      }
      const busy = new Set<string>();
      for (const ticket of tickets) {
        if (!ticket.scheduledAt || !ticket.reservedDesk?.id) continue;
        if (this.formatDate(ticket.scheduledAt) !== date) continue;
        const tStart = ticket.scheduledAt.getTime();
        const tEnd = tStart + ticket.durationMinutes * 60_000;
        if (startMs < tEnd && endMs > tStart) busy.add(ticket.reservedDesk.id);
      }
      for (const hold of heldSlots) {
        const holdStart = new Date(hold.scheduledAt).getTime();
        const holdEnd = holdStart + duration * 60_000;
        if (startMs < holdEnd && endMs > holdStart) busy.add(hold.deskId);
      }
      for (const block of blocks) {
        const bStart = this.slotToDate(date, block.startTime, timeZone).getTime();
        const bEnd = this.slotToDate(date, block.endTime, timeZone).getTime();
        if (startMs < bEnd && endMs > bStart && block.employee?.desk?.id) {
          busy.add(block.employee.desk.id);
        }
      }
      return {
        time,
        scheduledAt: scheduledAt.toISOString(),
        available: desks.some((desk) => !busy.has(desk.id)),
      };
    });
  }

  async assertSlotAvailable(
    siteId: string,

    scheduledAt: Date,

    durationMinutes: number,

    country: ClientCountry,

    excludeTicketId?: string,
  ): Promise<void> {
    const date = this.formatDate(scheduledAt);

    this.assertWeekday(date);

    const minutes = this.timeToMinutes(this.formatTime(scheduledAt));

    if (minutes < WORKDAY_START_MINUTES) {
      throw new BadRequestException('Запись доступна с 8:00');
    }

    if (minutes + durationMinutes > WORKDAY_END_MINUTES) {
      throw new BadRequestException('Запись доступна до 17:00');
    }

    if (scheduledAt.getTime() <= Date.now()) {
      throw new BadRequestException('Выберите время в будущем');
    }

    const free = await this.isSlotFree(
      siteId,

      scheduledAt,

      durationMinutes,

      country,

      excludeTicketId,
    );

    if (!free) {
      throw new ConflictException(
        'Выбранное время уже занято или заблокировано',
      );
    }
  }

  async reserveDesk(
    siteId: string,

    country: ClientCountry,

    scheduledAt: Date,

    durationMinutes: number,

    excludeTicketId?: string,

    preferredDeskId?: string,
  ): Promise<Desk> {
    const desks = await this.dataSource.getRepository(Desk).find({
      where: { site: { id: siteId }, active: true, country },

      order: { label: 'ASC' },
    });

    if (!desks.length) {
      throw new ConflictException('Нет столов для выбранного направления');
    }

    const slotDate = this.formatDate(scheduledAt);

    const startMs = scheduledAt.getTime();

    const endMs = startMs + durationMinutes * 60_000;

    const busyDeskIds = await this.busyDeskIds(
      siteId,

      country,

      slotDate,

      startMs,

      endMs,

      excludeTicketId,
    );

    const blockedDeskIds = await this.blockedDeskIds(
      siteId,

      slotDate,

      startMs,

      endMs,
    );

    const freeDesks = desks.filter(
      (desk) => !busyDeskIds.has(desk.id) && !blockedDeskIds.has(desk.id),
    );
    const freeDesk =
      (preferredDeskId
        ? freeDesks.find((desk) => desk.id === preferredDeskId)
        : undefined) ?? freeDesks[0];

    if (!freeDesk) {
      throw new ConflictException(
        'Выбранное время уже занято или заблокировано',
      );
    }

    return freeDesk;
  }

  async isSlotFree(
    siteId: string,

    scheduledAt: Date,

    durationMinutes: number,

    country: ClientCountry,

    excludeTicketId?: string,

    date?: string,
  ): Promise<boolean> {
    const startMs = scheduledAt.getTime();

    const endMs = startMs + durationMinutes * 60_000;

    const slotDate = date ?? this.formatDate(scheduledAt);

    const desks = await this.dataSource.getRepository(Desk).find({
      where: { site: { id: siteId }, active: true, country },
    });

    if (!desks.length) return false;

    const busyDeskIds = await this.busyDeskIds(
      siteId,

      country,

      slotDate,

      startMs,

      endMs,

      excludeTicketId,
    );

    const blockedDeskIds = await this.blockedDeskIds(
      siteId,

      slotDate,

      startMs,

      endMs,
    );

    return desks.some(
      (desk) => !busyDeskIds.has(desk.id) && !blockedDeskIds.has(desk.id),
    );
  }

  async getDaySchedule(siteId: string, date: string) {
    this.assertWeekday(date);

    const dayStart = this.slotToDate(date, '00:00');
    const [year, month, day] = date.split('-').map(Number);
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    const nextDate = next.toISOString().slice(0, 10);
    const dayEnd = this.slotToDate(nextDate, '00:00');

    const tickets = await this.dataSource.getRepository(Ticket).find({
      where: {
        site: { id: siteId },

        status: In([...ACTIVE_SLOT_STATUSES, 'COMPLETED']),
      },

      relations: {
        serviceType: true,

        assignments: { employee: true },

        reservedDesk: true,
      },

      order: { scheduledAt: 'ASC' },
    });

    return tickets

      .filter((ticket) => {
        if (!ticket.scheduledAt) return false;

        const t = ticket.scheduledAt.getTime();

        return t >= dayStart.getTime() && t < dayEnd.getTime();
      })

      .map((ticket) => {
        return {
          scheduledAt: ticket.scheduledAt!.toISOString(),

          durationMinutes: ticket.durationMinutes,

          occupied: true,
        };
      });
  }

  async listBlockedSlots(siteId: string) {
    const rows = await this.dataSource.getRepository(BlockedSlot).find({
      where: { site: { id: siteId } },

      relations: { employee: true },

      order: { date: 'ASC', startTime: 'ASC' },
    });

    return rows.map((row) => ({
      id: row.id,

      employeeId: row.employee.id,

      employeeName: row.employee.displayName,

      date: row.date,

      startTime: row.startTime,

      endTime: row.endTime,

      reason: row.reason,
    }));
  }

  async createBlockedSlot(
    actorSubject: string,

    siteId: string,

    employeeId: string,

    date: string,

    startTime: string,

    endTime: string,

    reason?: string,
  ) {
    this.assertWeekday(date);

    if (this.timeToMinutes(startTime) >= this.timeToMinutes(endTime)) {
      throw new BadRequestException('Время окончания должно быть позже начала');
    }

    const site = await this.dataSource.getRepository(Site).findOneBy({
      id: siteId,

      active: true,
    });

    if (!site) throw new NotFoundException('Площадка не найдена');

    const employee = await this.dataSource.getRepository(Employee).findOne({
      where: { id: employeeId },

      relations: { site: true },
    });

    if (!employee) throw new NotFoundException('Сотрудник не найден');

    if (employee.role === 'ADMIN') {
      throw new BadRequestException('Нельзя блокировать время администратора');
    }

    if (employee.site && employee.site.id !== siteId) {
      throw new BadRequestException('Сотрудник относится к другой площадке');
    }

    const row = await this.dataSource.getRepository(BlockedSlot).save({
      site,

      employee,

      date,

      startTime,

      endTime,

      reason,
    });

    await this.dataSource.getRepository(AuditEvent).save({
      actorSubject,

      action: 'BLOCKED_SLOT_CREATED',

      targetId: row.id,

      details: { siteId, employeeId, date, startTime, endTime },
    });

    return {
      id: row.id,

      employeeId: employee.id,

      employeeName: employee.displayName,

      date: row.date,

      startTime: row.startTime,

      endTime: row.endTime,

      reason: row.reason,
    };
  }

  async deleteBlockedSlot(id: string, actorSubject: string): Promise<void> {
    await this.dataSource.getRepository(BlockedSlot).delete({ id });

    await this.dataSource.getRepository(AuditEvent).save({
      actorSubject,

      action: 'BLOCKED_SLOT_DELETED',

      targetId: id,

      details: {},
    });
  }

  maskName(value?: string): string {
    if (!value?.trim()) return '—';

    const parts = value.trim().split(/\s+/);

    if (parts.length === 1) return parts[0];

    const last = parts[0];

    const firstInitial = parts[1]?.[0]?.toUpperCase() ?? '';

    const patronymicInitial = parts[2]?.[0]
      ? ` ${parts[2][0].toUpperCase()}.`
      : '';

    return `${last} ${firstInitial}.${patronymicInitial}`.trim();
  }

  formatScheduledLabel(value?: Date): string {
    if (!value) return '';

    return value.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',

      day: 'numeric',

      month: 'long',

      hour: '2-digit',

      minute: '2-digit',
    });
  }

  private async countOverlappingBookings(
    siteId: string,

    country: ClientCountry,

    slotDate: string,

    startMs: number,

    endMs: number,

    excludeTicketId?: string,
  ): Promise<number> {
    const tickets = await this.dataSource.getRepository(Ticket).find({
      where: {
        site: { id: siteId },

        country,

        status: In([...ACTIVE_SLOT_STATUSES]),

        ...(excludeTicketId ? { id: Not(excludeTicketId) } : {}),
      },
    });

    let count = 0;

    for (const ticket of tickets) {
      if (!ticket.scheduledAt) continue;

      if (this.formatDate(ticket.scheduledAt) !== slotDate) continue;

      const tStart = ticket.scheduledAt.getTime();

      const tEnd = tStart + ticket.durationMinutes * 60_000;

      if (startMs < tEnd && endMs > tStart) count += 1;
    }

    return count;
  }

  private async busyDeskIds(
    siteId: string,

    country: ClientCountry,

    slotDate: string,

    startMs: number,

    endMs: number,

    excludeTicketId?: string,
  ): Promise<Set<string>> {
    const tickets = await this.dataSource.getRepository(Ticket).find({
      where: {
        site: { id: siteId },

        country,

        status: In([...ACTIVE_SLOT_STATUSES]),

        ...(excludeTicketId ? { id: Not(excludeTicketId) } : {}),
      },

      relations: { reservedDesk: true },
    });

    const busy = new Set<string>();

    for (const ticket of tickets) {
      if (!ticket.scheduledAt || !ticket.reservedDesk?.id) continue;

      if (this.formatDate(ticket.scheduledAt) !== slotDate) continue;

      const tStart = ticket.scheduledAt.getTime();

      const tEnd = tStart + ticket.durationMinutes * 60_000;

      if (startMs < tEnd && endMs > tStart) {
        busy.add(ticket.reservedDesk.id);
      }
    }

    for (const deskId of await this.rateLimit.heldDeskIds(
      startMs,
      endMs,
      20,
    )) {
      busy.add(deskId);
    }

    return busy;
  }

  private async blockedDeskIds(
    siteId: string,

    slotDate: string,

    startMs: number,

    endMs: number,
  ): Promise<Set<string>> {
    const blocks = await this.dataSource.getRepository(BlockedSlot).find({
      where: { site: { id: siteId }, date: slotDate },

      relations: { employee: { desk: true } },
    });

    const blocked = new Set<string>();

    for (const block of blocks) {
      const bStart = this.slotToDate(slotDate, block.startTime).getTime();

      const bEnd = this.slotToDate(slotDate, block.endTime).getTime();

      if (startMs < bEnd && endMs > bStart) {
        const deskId = block.employee?.desk?.id;

        if (deskId) blocked.add(deskId);
      }
    }

    return blocked;
  }

  private assertWeekday(date: string): void {
    const day = this.slotToDate(date, '12:00').getDay();

    if (day === 0 || day === 6) {
      throw new BadRequestException('Запись доступна только в рабочие дни');
    }
  }

  private formatDate(value: Date): string {
    return value.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  }

  private formatTime(value: Date): string {
    return value.toLocaleTimeString('en-GB', {
      timeZone: 'Europe/Moscow',

      hour: '2-digit',

      minute: '2-digit',

      hour12: false,
    });
  }

  private minutesToTime(total: number): string {
    const h = Math.floor(total / 60);

    const m = total % 60;

    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  private timeToMinutes(value: string): number {
    const [h, m] = value.split(':').map(Number);

    return h * 60 + m;
  }
}
