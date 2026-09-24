import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, EntityManager, In, Like, QueryFailedError } from 'typeorm';
import {
  Assignment,
  AuditEvent,
  Desk,
  Employee,
  type EmployeeStatus,
  LIVE_QUEUE_STATUSES,
  ServiceType,
  Site,
  Ticket,
  TicketEvent,
  type ClientCountry,
  type TicketStatus,
} from '../domain/entities';
import type { SessionUser } from '../auth/auth';
import { KeycloakAdminService } from '../auth/keycloak-admin.service';
import {
  blocksBreak,
  canCancel,
  canCheckIn,
  canReleaseOnBreak,
  checkInWindowExpired,
  nextTicketStatus,
  type AssignmentAction,
} from './queue.rules';
import { BookingService } from './booking.service';
import { QueueUpdatesService } from './queue-updates.service';
import { RateLimitService } from './rate-limit.service';

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private dispatchTimer?: NodeJS.Timeout;

  constructor(
    private readonly dataSource: DataSource,
    private readonly booking: BookingService,
    private readonly rateLimit: RateLimitService,
    private readonly keycloakAdmin: KeycloakAdminService,
    private readonly updates: QueueUpdatesService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.dataSource
      .getRepository(Employee)
      .update(
        { oidcSubject: Like('integration-employee%') },
        { status: 'PAUSED' },
      );
    const sites = this.dataSource.getRepository(Site);
    if (!(await sites.count())) {
      const site = await sites.save(
        sites.create({ code: 'MAIN', name: 'Очередь' }),
      );
      await this.dataSource.getRepository(ServiceType).save({
        name: 'Предоставление и сдача маршрутного листа',
        slaSeconds: 1200,
        site,
      });
      await this.dataSource.getRepository(Desk).save([
        { label: 'Стол РФ-1', country: 'RF' as const, site },
        { label: 'Стол РФ-2', country: 'RF' as const, site },
        { label: 'Стол Китай', country: 'CN' as const, site },
      ]);
    }
    this.dispatchTimer = setInterval(() => {
      void this.dispatchAvailable().catch((error: unknown) => {
        this.logger.error('Queue dispatch failed', error);
      });
    }, 12_000);
    this.dispatchTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.dispatchTimer) clearInterval(this.dispatchTimer);
  }

  async getCatalog(): Promise<Site[]> {
    return this.dataSource.getRepository(Site).find({
      where: { active: true },
      order: { name: 'ASC' },
    });
  }

  async getServices(siteId: string): Promise<ServiceType[]> {
    return this.dataSource.getRepository(ServiceType).find({
      where: { site: { id: siteId }, active: true },
      order: { name: 'ASC' },
    });
  }

  async holdSlot(
    sessionId: string,
    siteId: string,
    country: ClientCountry,
    scheduledAtIso: string,
  ) {
    const scheduledAt = new Date(scheduledAtIso);
    const existing = await this.rateLimit.getSessionHold(sessionId);
    if (
      existing &&
      new Date(existing.scheduledAt).getTime() === scheduledAt.getTime()
    ) {
      const ttl = await this.rateLimit.holdTtl(
        existing.deskId,
        existing.scheduledAt,
      );
      return {
        holdId: existing.holdId,
        deskId: existing.deskId,
        scheduledAt: existing.scheduledAt,
        expiresAt: new Date(Date.now() + Math.max(ttl, 1) * 1000).toISOString(),
        expiresInSeconds: Math.max(ttl, 1),
        canRefresh: !(await this.rateLimit.hasRefreshedHold(sessionId)),
      };
    }
    const durationMinutes = this.booking.durationFor(country);
    await this.booking.assertSlotAvailable(
      siteId,
      scheduledAt,
      durationMinutes,
      country,
    );
    const desk = await this.booking.reserveDesk(
      siteId,
      country,
      scheduledAt,
      durationMinutes,
    );
    const holdId = randomBytes(8).toString('hex');
    const held = await this.rateLimit.holdSlot(
      sessionId,
      desk.id,
      scheduledAt.toISOString(),
      holdId,
    );
    if (!held) {
      throw new ConflictException('Это время уже удерживается');
    }
    const ttl = await this.rateLimit.holdTtl(
      desk.id,
      scheduledAt.toISOString(),
    );
    return {
      holdId,
      deskId: desk.id,
      deskLabel: desk.label,
      scheduledAt: scheduledAt.toISOString(),
      expiresAt: new Date(Date.now() + Math.max(ttl, 1) * 1000).toISOString(),
      expiresInSeconds: Math.max(ttl, 1),
      canRefresh: true,
    };
  }

  async refreshHold(sessionId: string, holdId: string) {
    const refreshed = await this.rateLimit.refreshHold(sessionId, holdId);
    if (!refreshed) {
      throw new ConflictException('Продлить бронь слота больше нельзя');
    }
    const peeked = await this.rateLimit.peekHold(sessionId, holdId);
    if (!peeked) {
      throw new ConflictException('Бронь слота истекла');
    }
    const ttl = await this.rateLimit.holdTtl(peeked.deskId, peeked.scheduledAt);
    return {
      holdId,
      deskId: peeked.deskId,
      scheduledAt: peeked.scheduledAt,
      expiresAt: new Date(Date.now() + Math.max(ttl, 1) * 1000).toISOString(),
      expiresInSeconds: Math.max(ttl, 1),
      canRefresh: false,
    };
  }

  async createTicket(input: {
    siteId: string;
    serviceTypeId: string;
    country: ClientCountry;
    fullName: string;
    departureDate: string;
    arrivalDate: string;
    scheduledAt: string;
    sessionId: string;
    holdId: string;
  }) {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(rawToken);
    const lookupCode = this.generateLookupCode();
    const lookupCodeHash = this.hashToken(lookupCode);
    const scheduledAt = new Date(input.scheduledAt);
    const durationMinutes = this.booking.durationFor(input.country);
    const departureDate = input.departureDate.trim();
    const arrivalDate = input.arrivalDate.trim();
    if (arrivalDate < departureDate) {
      throw new BadRequestException(
        'Дата приезда не может быть раньше даты выезда',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const site = await manager.findOneBy(Site, {
        id: input.siteId,
        active: true,
      });
      const serviceType = await manager.findOne(ServiceType, {
        where: {
          id: input.serviceTypeId,
          active: true,
          site: { id: input.siteId },
        },
        relations: { site: true },
      });
      if (!site || !serviceType)
        throw new NotFoundException('Услуга не найдена');

      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        input.siteId,
      ]);

      const hold = await this.rateLimit.peekHold(input.sessionId, input.holdId);
      if (
        !hold ||
        new Date(hold.scheduledAt).getTime() !== scheduledAt.getTime()
      ) {
        throw new ConflictException(
          'Бронь слота истекла, выберите время снова',
        );
      }
      const consumed = await this.rateLimit.consumeHold(
        input.sessionId,
        input.holdId,
        hold.deskId,
        hold.scheduledAt,
      );
      if (!consumed) {
        throw new ConflictException(
          'Бронь слота истекла, выберите время снова',
        );
      }

      await this.booking.assertSlotAvailable(
        input.siteId,
        scheduledAt,
        durationMinutes,
        input.country,
      );
      const reservedDesk = await this.booking.reserveDesk(
        input.siteId,
        input.country,
        scheduledAt,
        durationMinutes,
        undefined,
        hold.deskId,
      );

      const count = await manager
        .createQueryBuilder(Ticket, 'ticket')
        .where('ticket.siteId = :siteId', { siteId: input.siteId })
        .andWhere(
          "ticket.createdAt >= (date_trunc('day', now() AT TIME ZONE :timezone) AT TIME ZONE :timezone)",
          { timezone: site.timezone },
        )
        .getCount();
      try {
        const ticket = await manager.save(
          manager.create(Ticket, {
            number: `${site.code}-${String(count + 1).padStart(3, '0')}`,
            accessTokenHash: tokenHash,
            lookupCodeHash,
            status: 'BOOKED',
            site,
            serviceType,
            country: input.country,
            fullName: input.fullName.trim(),
            departureDate,
            arrivalDate,
            personalDataConsentAt: new Date(),
            scheduledAt,
            durationMinutes,
            reservedDesk,
          }),
        );
        await this.event(
          manager,
          ticket.id,
          'CREATED',
          {
            country: input.country,
            scheduledAt: scheduledAt.toISOString(),
            deskId: reservedDesk.id,
            deskLabel: reservedDesk.label,
          },
          undefined,
        );
        ticket.site = site;
        const queueMeta = await this.getQueueMeta(ticket);
        return {
          ticket: this.toPublic(
            ticket,
            serviceType,
            reservedDesk.label,
            queueMeta,
            undefined,
            lookupCode,
          ),
          tokenHash,
          lookupCode,
        };
      } catch (error) {
        if (
          error instanceof QueryFailedError &&
          (error as QueryFailedError & { driverError?: { code?: string } })
            .driverError?.code === '23505'
        ) {
          throw new ConflictException(
            'Выбранное время уже занято или заблокировано',
          );
        }
        throw error;
      }
    });
  }

  async getPublicTicketByHash(tokenHash: string) {
    const ticket = await this.dataSource.getRepository(Ticket).findOne({
      where: { accessTokenHash: tokenHash },
      relations: {
        serviceType: true,
        site: true,
        reservedDesk: true,
        assignments: { desk: true, employee: true },
      },
    });
    if (!ticket) throw new NotFoundException('Талон не найден');
    const active = ticket.assignments?.find((assignment) => assignment.active);
    const served = ticket.assignments
      ?.filter((assignment) => assignment.completedAt)
      .sort(
        (a, b) =>
          (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0),
      )[0];
    const queueMeta = await this.getQueueMeta(ticket);
    return this.toPublic(
      ticket,
      ticket.serviceType,
      active?.desk?.label ?? ticket.reservedDesk?.label,
      queueMeta,
      served?.employee.displayName,
    );
  }

  async lookupTicket(number: string, lookupCode: string) {
    const lookupCodeHash = this.hashToken(lookupCode.trim().toUpperCase());
    const digits = number.replace(/\D/g, '');
    if (!digits) throw new NotFoundException('Запись не найдена');
    const padded = digits.padStart(3, '0');
    const ticket = await this.dataSource
      .getRepository(Ticket)
      .createQueryBuilder('ticket')
      .leftJoinAndSelect('ticket.serviceType', 'serviceType')
      .leftJoinAndSelect('ticket.site', 'site')
      .leftJoinAndSelect('ticket.reservedDesk', 'reservedDesk')
      .leftJoinAndSelect('ticket.assignments', 'assignments')
      .leftJoinAndSelect('assignments.desk', 'assignmentDesk')
      .leftJoinAndSelect('assignments.employee', 'assignmentEmployee')
      .where('ticket.lookupCodeHash = :lookupCodeHash', { lookupCodeHash })
      .andWhere(
        `regexp_replace(ticket.number, '\\D', '', 'g') IN (:...serials)`,
        { serials: [...new Set([digits, padded])] },
      )
      .getOne();
    if (!ticket) throw new NotFoundException('Запись не найдена');
    const queueMeta = await this.getQueueMeta(ticket);
    return {
      ticket: this.toPublic(
        ticket,
        ticket.serviceType,
        ticket.reservedDesk?.label,
        queueMeta,
        undefined,
        lookupCode.trim().toUpperCase(),
      ),
      tokenHash: ticket.accessTokenHash,
    };
  }

  async checkInByHash(tokenHash: string) {
    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(Ticket, {
        where: { accessTokenHash: tokenHash },
        lock: { mode: 'pessimistic_write' },
      });
      const ticket = locked
        ? await manager.findOne(Ticket, {
            where: { id: locked.id },
            relations: {
              serviceType: true,
              site: true,
              reservedDesk: true,
            },
          })
        : null;
      if (!ticket) throw new NotFoundException('Талон не найден');
      if (
        !canCheckIn(ticket.status, ticket.scheduledAt, ticket.durationMinutes)
      ) {
        throw new BadRequestException(
          'Отметить явку можно за 15 минут до слота и до его окончания',
        );
      }
      ticket.status = 'CHECKED_IN';
      ticket.priority = 1;
      ticket.checkedInAt = new Date();
      await manager.save(ticket);
      await this.event(manager, ticket.id, 'CHECKED_IN', {}, undefined);
      await this.assignSpecificTicket(manager, ticket);
      const queueMeta = await this.getQueueMeta(ticket);
      return this.toPublic(
        ticket,
        ticket.serviceType,
        ticket.reservedDesk?.label,
        queueMeta,
      );
    });
  }

  async markNoShow(user: SessionUser, ticketId: string) {
    return this.dataSource.transaction(async (manager) => {
      const ticket = await manager.findOne(Ticket, {
        where: { id: ticketId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ticket) throw new NotFoundException('Заявка не найдена');
      if (ticket.status !== 'BOOKED') {
        throw new ConflictException(
          'Неявку можно отметить только для записи без явки',
        );
      }
      if (!checkInWindowExpired(ticket.scheduledAt, ticket.durationMinutes)) {
        throw new BadRequestException('Окно явки ещё не закончилось');
      }
      ticket.status = 'NO_SHOW';
      await manager.save(ticket);
      await this.event(manager, ticket.id, 'NO_SHOW', {}, user.subject);
      await this.audit(manager, user.subject, 'TICKET_NO_SHOW', ticket.id, {});
      return { id: ticket.id, number: ticket.number, status: ticket.status };
    });
  }

  async getTicketHistory(hashes: string[]) {
    if (!hashes.length) return [];
    const tickets = await this.dataSource.getRepository(Ticket).find({
      where: { accessTokenHash: In(hashes) },
      relations: {
        serviceType: true,
        assignments: { employee: true },
      },
      order: { scheduledAt: 'DESC' },
    });
    return tickets.map((ticket) => {
      const served = ticket.assignments
        ?.filter((assignment) => assignment.completedAt)
        .sort(
          (a, b) =>
            (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0),
        )[0];
      return this.toPublic(
        ticket,
        ticket.serviceType,
        undefined,
        { queuePosition: 0, estimatedWaitMinutes: 0 },
        served?.employee.displayName,
      );
    });
  }

  async rescheduleTicket(
    user: SessionUser,
    ticketId: string,
    scheduledAtIso: string,
  ) {
    const scheduledAt = new Date(scheduledAtIso);
    return this.dataSource.transaction(async (manager) => {
      const ticket = await manager.findOne(Ticket, {
        where: { id: ticketId },
        relations: { site: true, serviceType: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ticket) throw new NotFoundException('Заявка не найдена');
      if (!ticket.scheduledAt || !ticket.country) {
        throw new BadRequestException('Заявка без записи на время');
      }
      if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(ticket.status)) {
        throw new ConflictException('Заявку уже нельзя перенести');
      }
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        ticket.site.id,
      ]);
      await this.booking.assertSlotAvailable(
        ticket.site.id,
        scheduledAt,
        ticket.durationMinutes,
        ticket.country,
        ticket.id,
      );
      const reservedDesk = await this.booking.reserveDesk(
        ticket.site.id,
        ticket.country,
        scheduledAt,
        ticket.durationMinutes,
        ticket.id,
      );
      const previous = ticket.scheduledAt.toISOString();
      ticket.scheduledAt = scheduledAt;
      ticket.reservedDesk = reservedDesk;
      ticket.clientNotice = `Ваша запись перенесена на ${this.booking.formatScheduledLabel(scheduledAt)}. Стол: ${reservedDesk.label}`;
      await manager.save(ticket);
      await this.event(
        manager,
        ticket.id,
        'RESCHEDULED',
        { from: previous, to: scheduledAt.toISOString() },
        user.subject,
      );
      await this.audit(manager, user.subject, 'TICKET_RESCHEDULED', ticket.id, {
        from: previous,
        to: scheduledAt.toISOString(),
      });
      const queueMeta = await this.getQueueMeta(ticket);
      return this.toPublic(
        ticket,
        ticket.serviceType,
        reservedDesk.label,
        queueMeta,
      );
    });
  }

  async cancelTicketByHash(tokenHash: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const ticket = await manager.findOne(Ticket, {
        where: { accessTokenHash: tokenHash },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ticket) throw new NotFoundException('Талон не найден');
      if (!canCancel(ticket.status)) {
        throw new ConflictException('Талон уже нельзя отменить');
      }
      ticket.status = 'CANCELLED';
      await manager.save(ticket);
      const assignment = await manager.findOne(Assignment, {
        where: { ticket: { id: ticket.id }, active: true },
        relations: { employee: true },
      });
      if (assignment) {
        assignment.active = false;
        assignment.employee.status = 'AVAILABLE';
        await manager.save([assignment, assignment.employee]);
      }
      await this.event(manager, ticket.id, 'CANCELLED', {}, undefined);
    });
  }

  async ensureEmployee(user: SessionUser): Promise<Employee> {
    const repository = this.dataSource.getRepository(Employee);
    let employee = await repository.findOne({
      where: { oidcSubject: user.subject },
      relations: { site: true, desk: true },
    });
    if (employee) {
      if (!employee.site) {
        const site = await this.dataSource.getRepository(Site).findOne({
          where: { active: true },
          order: { name: 'ASC' },
        });
        if (site) {
          employee.site = site;
          employee = await repository.save(employee);
        }
      }
      return employee;
    }
    const site = await this.dataSource.getRepository(Site).findOneByOrFail({
      active: true,
    });
    employee = repository.create({
      oidcSubject: user.subject,
      displayName: user.displayName,
      role: user.roles.includes('ADMIN') ? 'ADMIN' : 'EMPLOYEE',
      site,
    });
    return repository.save(employee);
  }

  async listEmployeeDesks(user: SessionUser) {
    const employee = await this.ensureEmployee(user);
    if (!employee.site) {
      throw new NotFoundException('Площадка не настроена');
    }
    const desks = await this.dataSource.getRepository(Desk).find({
      where: {
        site: { id: employee.site.id },
        active: true,
        ...(employee.country ? { country: employee.country } : {}),
      },
      order: { label: 'ASC' },
    });
    if (!desks.length) return [];
    const occupants = await this.dataSource.getRepository(Employee).find({
      where: { desk: { id: In(desks.map((desk) => desk.id)) } },
      relations: { desk: true },
    });
    const occupantByDesk = new Map(
      occupants.filter((row) => row.desk?.id).map((row) => [row.desk!.id, row]),
    );
    return desks.map((desk) => {
      const occupant = occupantByDesk.get(desk.id);
      return {
        id: desk.id,
        label: desk.label,
        country: desk.country,
        occupiedBy:
          occupant && occupant.id !== employee.id ? occupant.displayName : null,
        isMine: occupant?.id === employee.id,
      };
    });
  }

  async assignSelfDesk(user: SessionUser, deskId: string | null) {
    const employee = await this.ensureEmployee(user);
    return this.assignEmployeeDesk(user.subject, employee.id, deskId);
  }

  async setEmployeeStatus(
    user: SessionUser,
    status: EmployeeStatus,
  ): Promise<{ employee: Employee; assignment: Assignment | null }> {
    return this.dataSource.transaction(async (manager) => {
      const current = await this.ensureEmployee(user);
      const lockedEmployee = await manager.findOne(Employee, {
        where: { id: current.id },
        lock: { mode: 'pessimistic_write' },
      });
      const employee = lockedEmployee
        ? await manager.findOne(Employee, {
            where: { id: lockedEmployee.id },
            relations: { site: true, desk: true },
          })
        : null;
      if (!employee) throw new NotFoundException('Сотрудник не найден');
      if (status === 'AVAILABLE' && !employee.desk) {
        throw new BadRequestException('Сначала выберите рабочий стол');
      }
      const active = await manager.findOne(Assignment, {
        where: { employee: { id: employee.id }, active: true },
        relations: { ticket: { serviceType: true }, desk: true },
      });
      if (active && ['PAUSED', 'OFFLINE'].includes(status)) {
        await this.releaseAssignmentForBreak(
          manager,
          active,
          user.subject,
          status,
        );
      } else if (active && status !== 'AVAILABLE') {
        throw new ConflictException('Сначала завершите текущий талон');
      }
      employee.status = status;
      await manager.save(employee);
      const assignment =
        status === 'AVAILABLE'
          ? await this.assignNext(manager, employee)
          : null;
      await this.audit(
        manager,
        user.subject,
        'EMPLOYEE_STATUS_CHANGED',
        employee.id,
        {
          status,
        },
      );
      return { employee, assignment };
    });
  }

  async getCurrent(user: SessionUser) {
    let employee = await this.ensureEmployee(user);
    employee =
      (await this.dataSource.getRepository(Employee).findOne({
        where: { id: employee.id },
        relations: { site: true, desk: true },
      })) ?? employee;
    const assignment = await this.dataSource.getRepository(Assignment).findOne({
      where: { employee: { id: employee.id }, active: true },
      relations: { ticket: { serviceType: true }, desk: true },
    });
    const queue = await this.getQueueSummary(employee.site?.id);
    const queueTickets = employee.site?.id
      ? await this.listLiveQueueTickets(employee.site.id)
      : [];
    const dayBookings = employee.site?.id
      ? await this.listDayBookings(employee.site.id)
      : [];
    const country = employee.country ?? employee.desk?.country;
    const queueEmptyReason = !employee.desk
      ? 'NO_DESK'
      : !country
        ? 'NO_COUNTRY'
        : queueTickets.length
          ? null
          : 'NO_CHECKED_IN';
    return {
      employee,
      assignment,
      queue,
      queueTickets,
      dayBookings,
      queueEmptyReason,
    };
  }

  async listEmployeeBookings(user: SessionUser, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Некорректная дата');
    }
    const employee = await this.ensureEmployee(user);
    if (!employee.site?.id) return [];
    const tickets = await this.dataSource.getRepository(Ticket).find({
      where: { site: { id: employee.site.id } },
      relations: { serviceType: true, reservedDesk: true },
      order: { scheduledAt: 'ASC', createdAt: 'ASC' },
    });
    return tickets
      .filter(
        (ticket) =>
          ticket.scheduledAt &&
          ticket.scheduledAt.toLocaleDateString('en-CA', {
            timeZone: 'Europe/Moscow',
          }) === date,
      )
      .map((ticket) => this.managerBookingView(ticket));
  }

  private managerBookingView(ticket: Ticket) {
    return {
      id: ticket.id,
      number: ticket.number,
      fullName: ticket.fullName,
      status: ticket.status,
      country: ticket.country,
      scheduledAt: ticket.scheduledAt?.toISOString(),
      scheduledLabel: ticket.scheduledAt
        ? this.booking.formatScheduledLabel(ticket.scheduledAt)
        : undefined,
      departureDate: ticket.departureDate,
      arrivalDate: ticket.arrivalDate,
      deskLabel: ticket.reservedDesk?.label,
      allowedStatuses: [
        'BOOKED',
        'CHECKED_IN',
        'IN_SERVICE',
        'COMPLETED',
        'NO_SHOW',
        'CANCELLED',
      ] as TicketStatus[],
    };
  }

  async setTicketStatus(
    user: SessionUser,
    ticketId: string,
    status: TicketStatus,
  ) {
    const allowed: TicketStatus[] = [
      'BOOKED',
      'CHECKED_IN',
      'IN_SERVICE',
      'COMPLETED',
      'NO_SHOW',
      'CANCELLED',
    ];
    if (!allowed.includes(status)) {
      throw new BadRequestException('Этот статус недоступен');
    }
    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(Ticket, {
        where: { id: ticketId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException('Заявка не найдена');
      const ticket = await manager.findOne(Ticket, {
        where: { id: locked.id },
        relations: { serviceType: true, reservedDesk: true, site: true },
      });
      if (!ticket) throw new NotFoundException('Заявка не найдена');
      const employee = await this.ensureEmployee(user);
      if (employee.site?.id && ticket.site?.id !== employee.site.id) {
        throw new ForbiddenException('Нет доступа к этой записи');
      }
      const previous = ticket.status;
      if (previous === status) {
        return this.managerBookingView(ticket);
      }
      ticket.status = status;
      if (status === 'CHECKED_IN' && !ticket.checkedInAt) {
        ticket.checkedInAt = new Date();
        ticket.priority = 1;
      }
      if (status === 'BOOKED') {
        ticket.priority = 0;
      }
      await manager.save(ticket);

      if (['COMPLETED', 'CANCELLED', 'NO_SHOW', 'BOOKED'].includes(status)) {
        const assignment = await manager.findOne(Assignment, {
          where: { ticket: { id: ticket.id }, active: true },
          relations: { employee: true },
        });
        if (assignment) {
          assignment.active = false;
          assignment.completedAt = new Date();
          if (assignment.employee) {
            assignment.employee.status = 'AVAILABLE';
            await manager.save([assignment, assignment.employee]);
          } else {
            await manager.save(assignment);
          }
        }
      }

      await this.event(manager, ticket.id, status, { previous }, user.subject);
      await this.audit(manager, user.subject, 'TICKET_STATUS_SET', ticket.id, {
        from: previous,
        to: status,
      });
      return this.managerBookingView(ticket);
    });
  }

  private staffTicketView(ticket: Ticket) {
    return {
      id: ticket.id,
      number: ticket.number,
      status: ticket.status,
      createdAt: ticket.createdAt.toISOString(),
      scheduledAt: ticket.scheduledAt?.toISOString(),
      scheduledLabel: ticket.scheduledAt
        ? this.booking.formatScheduledLabel(ticket.scheduledAt)
        : undefined,
      durationMinutes: ticket.durationMinutes,
      country: ticket.country,
      deskLabel: ticket.reservedDesk?.label,
      canMarkNoShow:
        ticket.status === 'BOOKED' &&
        checkInWindowExpired(ticket.scheduledAt, ticket.durationMinutes),
      serviceType: { name: ticket.serviceType.name },
    };
  }

  private async listLiveQueueTickets(siteId: string) {
    const tickets = await this.dataSource.getRepository(Ticket).find({
      where: LIVE_QUEUE_STATUSES.map((status) => ({
        site: { id: siteId },
        status,
      })),
      relations: { serviceType: true, reservedDesk: true },
      order: { priority: 'DESC', scheduledAt: 'ASC', createdAt: 'ASC' },
    });
    return tickets.map((ticket) => this.staffTicketView(ticket));
  }

  private async listDayBookings(siteId: string) {
    const start = new Date();
    const date = start.toLocaleDateString('en-CA', {
      timeZone: 'Europe/Moscow',
    });
    const tickets = await this.dataSource.getRepository(Ticket).find({
      where: { site: { id: siteId }, status: In(['BOOKED', 'NO_SHOW']) },
      relations: { serviceType: true, reservedDesk: true },
      order: { scheduledAt: 'ASC' },
    });
    return tickets
      .filter(
        (ticket) =>
          ticket.scheduledAt &&
          ticket.scheduledAt.toLocaleDateString('en-CA', {
            timeZone: 'Europe/Moscow',
          }) === date,
      )
      .map((ticket) => this.staffTicketView(ticket));
  }

  private async getQueueSummary(siteId?: string) {
    if (!siteId) {
      return { waitingCount: 0, availableAgents: 0 };
    }
    const ticketRepository = this.dataSource.getRepository(Ticket);
    const employeeRepository = this.dataSource.getRepository(Employee);
    const [waitingCount, availableAgents] = await Promise.all([
      ticketRepository.count({
        where: LIVE_QUEUE_STATUSES.map((status) => ({
          site: { id: siteId },
          status,
        })),
      }),
      employeeRepository.count({
        where: { site: { id: siteId }, status: 'AVAILABLE' },
      }),
    ]);
    return { waitingCount, availableAgents };
  }

  async assignmentAction(
    user: SessionUser,
    assignmentId: string,
    action: AssignmentAction,
    reason?: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const employee = await this.ensureEmployee(user);
      const lockedAssignment = await manager.findOne(Assignment, {
        where: {
          id: assignmentId,
          employee: { id: employee.id },
          active: true,
        },
        lock: { mode: 'pessimistic_write' },
      });
      const assignment = lockedAssignment
        ? await manager.findOne(Assignment, {
            where: { id: lockedAssignment.id },
            relations: {
              ticket: { serviceType: true },
              employee: true,
              desk: true,
            },
          })
        : null;
      if (!assignment) throw new NotFoundException('Назначение не найдено');
      const ticket = assignment.ticket;
      const next = nextTicketStatus(ticket.status, action);
      if (!next) {
        throw new BadRequestException(
          `Действие «${action}» недоступно для статуса «${ticket.status}»`,
        );
      }
      ticket.status = next;
      const now = new Date();
      if (action === 'CALL') {
        assignment.calledAt = now;
        ticket.callAttempts += 1;
      }
      if (action === 'START') {
        assignment.startedAt = now;
        assignment.employee.status = 'BUSY';
      }
      if (['COMPLETE', 'REQUEUE', 'NO_SHOW'].includes(action)) {
        assignment.active = false;
        assignment.completedAt = now;
        assignment.employee.status = 'AVAILABLE';
      }
      if (action === 'REQUEUE') {
        ticket.status = 'REQUEUED';
        ticket.priority = 0;
      }
      await manager.save([ticket, assignment, assignment.employee]);
      await this.event(manager, ticket.id, action, { reason }, user.subject);
      await this.audit(
        manager,
        user.subject,
        `ASSIGNMENT_${action}`,
        assignment.id,
        {
          ticketId: ticket.id,
          reason,
        },
      );
      const nextAssignment = ['COMPLETE', 'REQUEUE', 'NO_SHOW'].includes(action)
        ? await this.assignNext(manager, assignment.employee)
        : assignment;
      return { assignment, nextAssignment };
    });
  }

  async listAuditEvents(actorSubject: string, limit = 100) {
    await this.dataSource.getRepository(AuditEvent).save({
      actorSubject,
      action: 'AUDIT_VIEWED',
      details: {},
    });
    return this.dataSource.getRepository(AuditEvent).find({
      order: { occurredAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  async adminQueue(actorSubject: string) {
    await this.dataSource.getRepository(AuditEvent).save({
      actorSubject,
      action: 'ADMIN_QUEUE_VIEWED',
      details: {},
    });
    const tickets = await this.dataSource.getRepository(Ticket).find({
      where: {
        status: In([
          'BOOKED',
          'CHECKED_IN',
          'REQUEUED',
          'ASSIGNED',
          'CALLED',
          'IN_SERVICE',
        ]),
      },
      relations: {
        serviceType: true,
        reservedDesk: true,
        assignments: { employee: true, desk: true },
      },
      order: { scheduledAt: 'ASC', createdAt: 'ASC' },
    });
    return tickets.map((ticket) => {
      const active = ticket.assignments?.find(
        (assignment) => assignment.active,
      );
      return {
        ...this.staffTicketView(ticket),
        assignment: active
          ? {
              employeeName: active.employee.displayName,
              deskLabel: active.desk?.label,
            }
          : undefined,
      };
    });
  }

  async metrics(actorSubject: string) {
    await this.dataSource.getRepository(AuditEvent).save({
      actorSubject,
      action: 'EMPLOYEE_METRICS_VIEWED',
      details: {},
    });
    const rows = await this.dataSource
      .getRepository(Assignment)
      .createQueryBuilder('assignment')
      .innerJoin('assignment.employee', 'employee')
      .innerJoin('assignment.ticket', 'ticket')
      .innerJoin('ticket.serviceType', 'service')
      .select('employee.id', 'employeeId')
      .addSelect('employee.displayName', 'displayName')
      .addSelect('COUNT(*)', 'completed')
      .addSelect(
        'AVG(EXTRACT(EPOCH FROM (assignment.completedAt - assignment.startedAt)))',
        'averageHandlingSeconds',
      )
      .addSelect(
        'PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (assignment.completedAt - assignment.startedAt)))',
        'medianHandlingSeconds',
      )
      .addSelect(
        'PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (assignment.completedAt - assignment.startedAt)))',
        'p90HandlingSeconds',
      )
      .addSelect(
        '100.0 * AVG(CASE WHEN EXTRACT(EPOCH FROM (assignment.completedAt - assignment.startedAt)) <= service.slaSeconds THEN 1 ELSE 0 END)',
        'slaPercent',
      )
      .addSelect(
        'AVG(EXTRACT(EPOCH FROM (assignment.assignedAt - ticket.createdAt)))',
        'averageWaitSeconds',
      )
      .where('ticket.status = :status', { status: 'COMPLETED' })
      .andWhere('assignment.startedAt IS NOT NULL')
      .andWhere('assignment.completedAt IS NOT NULL')
      .groupBy('employee.id')
      .addGroupBy('employee.displayName')
      .getRawMany<Record<string, string>>();

    const noShowRows = await this.dataSource
      .getRepository(Assignment)
      .createQueryBuilder('assignment')
      .innerJoin('assignment.employee', 'employee')
      .innerJoin('assignment.ticket', 'ticket')
      .select('employee.id', 'employeeId')
      .addSelect('COUNT(*)', 'noShowCount')
      .where('ticket.status = :status', { status: 'NO_SHOW' })
      .groupBy('employee.id')
      .getRawMany<{ employeeId: string; noShowCount: string }>();
    const noShowMap = new Map(
      noShowRows.map((row) => [row.employeeId, Number(row.noShowCount)]),
    );

    return rows
      .map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            key === 'displayName' || key === 'employeeId'
              ? value
              : Number(value),
          ]),
        ),
      )
      .map((row) => ({
        ...row,
        noShowCount: noShowMap.get(String(row.employeeId)) ?? 0,
      }));
  }

  async metricsOverview(actorSubject: string) {
    await this.dataSource.getRepository(AuditEvent).save({
      actorSubject,
      action: 'QUEUE_OVERVIEW_VIEWED',
      details: {},
    });
    const ticketRepo = this.dataSource.getRepository(Ticket);
    const employeeRepo = this.dataSource.getRepository(Employee);
    const [
      waiting,
      inProgress,
      completedToday,
      cancelledToday,
      noShowToday,
      createdToday,
      availableAgents,
      activeDesks,
    ] = await Promise.all([
      ticketRepo.count({ where: { status: In([...LIVE_QUEUE_STATUSES]) } }),
      ticketRepo.count({
        where: { status: In(['ASSIGNED', 'CALLED', 'IN_SERVICE']) },
      }),
      ticketRepo
        .createQueryBuilder('ticket')
        .where('ticket.status = :status', { status: 'COMPLETED' })
        .andWhere("ticket.updatedAt >= date_trunc('day', now())")
        .getCount(),
      ticketRepo
        .createQueryBuilder('ticket')
        .where('ticket.status = :status', { status: 'CANCELLED' })
        .andWhere("ticket.updatedAt >= date_trunc('day', now())")
        .getCount(),
      ticketRepo
        .createQueryBuilder('ticket')
        .where('ticket.status = :status', { status: 'NO_SHOW' })
        .andWhere("ticket.updatedAt >= date_trunc('day', now())")
        .getCount(),
      ticketRepo
        .createQueryBuilder('ticket')
        .where("ticket.createdAt >= date_trunc('day', now())")
        .getCount(),
      employeeRepo.count({ where: { status: 'AVAILABLE' } }),
      this.dataSource.getRepository(Desk).count({ where: { active: true } }),
    ]);

    const timing = await this.dataSource
      .getRepository(Assignment)
      .createQueryBuilder('assignment')
      .innerJoin('assignment.ticket', 'ticket')
      .select(
        'AVG(EXTRACT(EPOCH FROM (assignment.assignedAt - ticket.createdAt)))',
        'averageWaitSeconds',
      )
      .addSelect(
        'AVG(EXTRACT(EPOCH FROM (assignment.completedAt - assignment.startedAt)))',
        'averageHandlingSeconds',
      )
      .where('assignment.completedAt IS NOT NULL')
      .andWhere("assignment.completedAt >= date_trunc('day', now())")
      .getRawOne<Record<string, string>>();

    const hourlyRows = await ticketRepo
      .createQueryBuilder('ticket')
      .select("date_trunc('hour', ticket.createdAt)", 'hour')
      .addSelect('COUNT(*)', 'count')
      .where("ticket.createdAt >= date_trunc('day', now())")
      .groupBy("date_trunc('hour', ticket.createdAt)")
      .orderBy("date_trunc('hour', ticket.createdAt)", 'ASC')
      .getRawMany<{ hour: Date; count: string }>();

    return {
      waiting,
      inProgress,
      completedToday,
      cancelledToday,
      noShowToday,
      createdToday,
      availableAgents,
      activeDesks,
      averageWaitSeconds: Number(timing?.averageWaitSeconds ?? 0),
      averageHandlingSeconds: Number(timing?.averageHandlingSeconds ?? 0),
      hourly: hourlyRows.map((row) => ({
        hour: new Date(row.hour).toISOString(),
        count: Number(row.count),
      })),
    };
  }

  async listDesks() {
    const desks = await this.dataSource.getRepository(Desk).find({
      where: { active: true },
      relations: { site: true },
      order: { label: 'ASC' },
    });
    if (!desks.length) return [];
    const assigned = await this.dataSource.getRepository(Employee).find({
      where: { desk: { id: In(desks.map((desk) => desk.id)) } },
      relations: { desk: true },
      order: { displayName: 'ASC' },
    });
    const byDesk = new Map<string, { id: string; displayName: string }[]>();
    for (const employee of assigned) {
      const deskId = employee.desk?.id;
      if (!deskId) continue;
      const list = byDesk.get(deskId) ?? [];
      list.push({ id: employee.id, displayName: employee.displayName });
      byDesk.set(deskId, list);
    }
    return desks.map((desk) => ({
      id: desk.id,
      label: desk.label,
      country: desk.country,
      active: desk.active,
      site: { id: desk.site.id, name: desk.site.name },
      employees: byDesk.get(desk.id) ?? [],
    }));
  }

  async createDesk(
    actorSubject: string,
    label: string,
    siteId: string,
    country: ClientCountry,
  ) {
    const site = await this.dataSource.getRepository(Site).findOneBy({
      id: siteId,
      active: true,
    });
    if (!site) throw new NotFoundException('Площадка не найдена');
    const desk = await this.dataSource.getRepository(Desk).save(
      this.dataSource.getRepository(Desk).create({
        label: label.trim(),
        site,
        country,
      }),
    );
    await this.dataSource.getRepository(AuditEvent).save({
      actorSubject,
      action: 'DESK_CREATED',
      targetId: desk.id,
      details: { label: desk.label, siteId, country },
    });
    return {
      id: desk.id,
      label: desk.label,
      country: desk.country,
      active: desk.active,
      site: { id: site.id, name: site.name },
      employees: [],
    };
  }

  async updateDesk(
    actorSubject: string,
    deskId: string,
    patch: { label?: string; active?: boolean; country?: ClientCountry },
  ) {
    const desk = await this.dataSource.getRepository(Desk).findOne({
      where: { id: deskId },
      relations: { site: true },
    });
    if (!desk) throw new NotFoundException('Стол не найден');
    if (patch.label !== undefined) desk.label = patch.label.trim();
    if (patch.active !== undefined) desk.active = patch.active;
    if (patch.country !== undefined) desk.country = patch.country;
    await this.dataSource.getRepository(Desk).save(desk);
    await this.dataSource.getRepository(AuditEvent).save({
      actorSubject,
      action: 'DESK_UPDATED',
      targetId: desk.id,
      details: patch,
    });
    return desk;
  }

  async listAdminEmployees() {
    return this.listManagers();
  }

  async listManagers() {
    const [keycloakUsers, dbEmployees] = await Promise.all([
      this.keycloakAdmin.listEmployeeUsers(),
      this.dataSource.getRepository(Employee).find({
        relations: { desk: true, site: true },
      }),
    ]);
    const bySubject = new Map(
      dbEmployees.map((employee) => [employee.oidcSubject, employee]),
    );
    return keycloakUsers
      .map((user) => {
        const employee = bySubject.get(user.id);
        const displayName =
          [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
          user.username;
        return {
          id: employee?.id ?? null,
          keycloakId: user.id,
          username: user.username,
          displayName: employee?.displayName ?? displayName,
          role: employee?.role ?? 'EMPLOYEE',
          status: employee?.status ?? 'OFFLINE',
          country: employee?.country ?? null,
          desk: employee?.desk
            ? { id: employee.desk.id, label: employee.desk.label }
            : null,
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'));
  }

  async createManager(
    actorSubject: string,
    input: {
      username: string;
      firstName: string;
      lastName: string;
      email?: string;
    },
  ) {
    const created = await this.keycloakAdmin.createEmployeeUser(input);
    const site = await this.dataSource.getRepository(Site).findOne({
      where: { active: true },
      order: { name: 'ASC' },
    });
    let employee = await this.dataSource.getRepository(Employee).findOne({
      where: { oidcSubject: created.userId },
    });
    if (!employee && site) {
      employee = await this.dataSource.getRepository(Employee).save(
        this.dataSource.getRepository(Employee).create({
          oidcSubject: created.userId,
          displayName:
            `${input.firstName.trim()} ${input.lastName.trim()}`.trim(),
          role: 'EMPLOYEE',
          site,
        }),
      );
    }
    await this.dataSource.getRepository(AuditEvent).save({
      actorSubject,
      action: 'MANAGER_CREATED',
      targetId: created.userId,
      details: { username: created.username },
    });
    return {
      id: employee?.id ?? null,
      keycloakId: created.userId,
      username: created.username,
      displayName: employee?.displayName ?? created.username,
      temporaryPassword: created.temporaryPassword,
    };
  }

  async resetManagerPassword(actorSubject: string, keycloakId: string) {
    const reset = await this.keycloakAdmin.resetUserPassword(keycloakId);
    await this.dataSource.getRepository(AuditEvent).save({
      actorSubject,
      action: 'MANAGER_PASSWORD_RESET',
      targetId: keycloakId,
      details: {},
    });
    return reset;
  }

  private async ensureEmployeeForCountryUpdate(
    manager: EntityManager,
    employeeId: string,
  ): Promise<Employee> {
    const locked = await manager.findOne(Employee, {
      where: { id: employeeId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!locked) throw new NotFoundException('Сотрудник не найден');
    const employee = await manager.findOne(Employee, {
      where: { id: locked.id },
      relations: { desk: true },
    });
    if (!employee) throw new NotFoundException('Сотрудник не найден');
    return employee;
  }

  async updateEmployeeCountry(
    actorSubject: string,
    employeeId: string,
    country: ClientCountry,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const employee = await this.ensureEmployeeForCountryUpdate(
        manager,
        employeeId,
      );
      if (employee.role === 'ADMIN') {
        throw new BadRequestException(
          'Нельзя изменить направление администратора',
        );
      }
      if (employee.country === country) {
        return {
          id: employee.id,
          displayName: employee.displayName,
          country: employee.country,
          desk: employee.desk
            ? { id: employee.desk.id, label: employee.desk.label }
            : null,
        };
      }
      const desk = employee.desk
        ? await manager.findOne(Desk, { where: { id: employee.desk.id } })
        : null;
      if (desk && desk.country !== country) {
        await this.releaseEmployeeForCountryChange(
          manager,
          employee.id,
          actorSubject,
        );
        await manager
          .createQueryBuilder()
          .relation(Employee, 'desk')
          .of(employee.id)
          .set(null);
      }
      await manager.update(Employee, { id: employee.id }, { country });
      await this.audit(
        manager,
        actorSubject,
        'EMPLOYEE_COUNTRY_UPDATED',
        employee.id,
        {
          country,
        },
      );
      const updated = await manager.findOne(Employee, {
        where: { id: employee.id },
        relations: { desk: true },
      });
      if (!updated) throw new NotFoundException('Сотрудник не найден');
      return {
        id: updated.id,
        displayName: updated.displayName,
        country: updated.country,
        desk: updated.desk
          ? { id: updated.desk.id, label: updated.desk.label }
          : null,
      };
    });
  }

  async updateManagerCountry(
    actorSubject: string,
    keycloakId: string,
    country: ClientCountry,
  ) {
    let employee = await this.dataSource.getRepository(Employee).findOne({
      where: { oidcSubject: keycloakId },
    });
    if (!employee) {
      const site = await this.dataSource.getRepository(Site).findOne({
        where: { active: true },
        order: { name: 'ASC' },
      });
      if (!site) throw new NotFoundException('Площадка не найдена');
      const users = await this.keycloakAdmin.listEmployeeUsers();
      const user = users.find((row) => row.id === keycloakId);
      if (!user) throw new NotFoundException('Пользователь не найден');
      employee = await this.dataSource.getRepository(Employee).save(
        this.dataSource.getRepository(Employee).create({
          oidcSubject: keycloakId,
          displayName:
            [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
            user.username,
          role: 'EMPLOYEE',
          site,
        }),
      );
    }
    return this.updateEmployeeCountry(actorSubject, employee.id, country);
  }

  async assignEmployeeDesk(
    actorSubject: string,
    employeeId: string,
    deskId: string | null,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const employee = await manager.findOne(Employee, {
        where: { id: employeeId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!employee) throw new NotFoundException('Сотрудник не найден');

      if (deskId) {
        const desk = await manager.findOne(Desk, {
          where: { id: deskId, active: true },
          relations: { site: true },
        });
        if (!desk) throw new NotFoundException('Стол не найден');

        if (employee.country && employee.country !== desk.country) {
          throw new BadRequestException(
            'Сотрудник работает с другим направлением (РФ/Китай)',
          );
        }

        const others = await manager.find(Employee, {
          where: { desk: { id: deskId } },
        });
        for (const other of others) {
          if (other.id !== employee.id) {
            await this.detachEmployeeDesk(manager, other.id, actorSubject);
          }
        }

        if (employee.desk?.id !== deskId) {
          await this.releaseEmployeeAssignmentsForDeskChange(
            manager,
            employee.id,
            actorSubject,
          );
        }

        const assignee = await manager.findOne(Employee, {
          where: { id: employee.id },
          relations: { site: true, desk: true },
        });
        if (!assignee) throw new NotFoundException('Сотрудник не найден');
        assignee.desk = desk;
        assignee.country = desk.country;
        assignee.site = assignee.site ?? desk.site;
        await manager.save(assignee);
      } else {
        await this.detachEmployeeDesk(manager, employee.id, actorSubject);
      }

      const updated = await manager.findOne(Employee, {
        where: { id: employee.id },
        relations: { desk: true },
      });
      if (!updated) throw new NotFoundException('Сотрудник не найден');
      await this.audit(
        manager,
        actorSubject,
        'EMPLOYEE_DESK_ASSIGNED',
        updated.id,
        {
          deskId,
        },
      );
      return {
        id: updated.id,
        displayName: updated.displayName,
        role: updated.role,
        status: updated.status,
        country: updated.country ?? null,
        desk: updated.desk
          ? { id: updated.desk.id, label: updated.desk.label }
          : null,
      };
    });
  }

  async deleteDesk(actorSubject: string, deskId: string) {
    return this.dataSource.transaction(async (manager) => {
      const desk = await manager.findOne(Desk, {
        where: { id: deskId },
        relations: { site: true },
      });
      if (!desk) throw new NotFoundException('Стол не найден');

      const assigned = await manager.find(Employee, {
        where: { desk: { id: deskId } },
      });
      for (const employee of assigned) {
        const activeAssignment = await manager.findOne(Assignment, {
          where: { employee: { id: employee.id }, active: true },
        });
        if (
          activeAssignment &&
          ['RESERVED', 'BUSY'].includes(employee.status)
        ) {
          throw new ConflictException(
            `Нельзя удалить стол — ${employee.displayName} обслуживает клиента`,
          );
        }
        employee.desk = undefined;
        await manager.save(employee);
      }

      const historyRefs = await manager.count(Assignment, {
        where: { desk: { id: deskId } },
      });
      if (historyRefs > 0) {
        desk.active = false;
        await manager.save(desk);
      } else {
        await manager.delete(Desk, deskId);
      }

      await this.audit(manager, actorSubject, 'DESK_DELETED', deskId, {
        soft: historyRefs > 0,
      });
      return { deleted: true, soft: historyRefs > 0 };
    });
  }

  async listSites() {
    return this.dataSource.getRepository(Site).find({
      where: { active: true },
      order: { name: 'ASC' },
    });
  }

  async dispatchAvailable(): Promise<void> {
    let changed = await this.recoverBreakAssignments();
    const employees = await this.dataSource.getRepository(Employee).find({
      where: { status: 'AVAILABLE' },
      relations: { site: true, desk: true },
      order: { updatedAt: 'ASC' },
      take: 100,
    });
    for (const employee of employees) {
      await this.dataSource.transaction(async (manager) => {
        const row = await manager.findOne(Employee, {
          where: { id: employee.id, status: 'AVAILABLE' },
          lock: { mode: 'pessimistic_write' },
        });
        const locked = row
          ? await manager.findOne(Employee, {
              where: { id: row.id },
              relations: { site: true, desk: true },
            })
          : null;
        if (locked && (await this.assignNext(manager, locked))) changed++;
      });
    }
    changed += await this.expireCalls();
    if (changed > 0) this.updates.notify();
  }

  private async expireCalls(): Promise<number> {
    const expired = await this.dataSource
      .getRepository(Assignment)
      .createQueryBuilder('assignment')
      .innerJoinAndSelect('assignment.ticket', 'ticket')
      .innerJoinAndSelect('assignment.employee', 'employee')
      .where('assignment.active = true')
      .andWhere("assignment.calledAt < NOW() - INTERVAL '90 seconds'")
      .andWhere('ticket.status = :status', { status: 'CALLED' })
      .getMany();
    for (const item of expired) {
      await this.dataSource.transaction(async (manager) => {
        const row = await manager.findOne(Assignment, {
          where: { id: item.id, active: true },
          lock: { mode: 'pessimistic_write' },
        });
        const assignment = row
          ? await manager.findOne(Assignment, {
              where: { id: row.id },
              relations: { ticket: true, employee: true },
            })
          : null;
        if (!assignment || assignment.ticket.status !== 'CALLED') return;
        assignment.active = false;
        if (assignment.ticket.callAttempts >= 2) {
          assignment.ticket.status = 'NO_SHOW';
        } else {
          assignment.ticket.status = 'REQUEUED';
          assignment.ticket.priority = 0;
        }
        assignment.employee.status = 'AVAILABLE';
        await manager.save(assignment);
        await manager.save(assignment.ticket);
        await manager.save(assignment.employee);
        await this.event(
          manager,
          assignment.ticket.id,
          assignment.ticket.status === 'NO_SHOW' ? 'NO_SHOW' : 'REQUEUED',
          { reason: 'call-timeout' },
          undefined,
        );
      });
    }
    return expired.length;
  }

  private async releaseEmployeeForCountryChange(
    manager: EntityManager,
    employeeId: string,
    actorSubject: string,
  ): Promise<void> {
    const active = await manager.findOne(Assignment, {
      where: { employee: { id: employeeId }, active: true },
      relations: { ticket: true },
    });
    if (!active) return;
    if (active.ticket.status === 'IN_SERVICE') {
      throw new ConflictException(
        'Сотрудник обслуживает клиента — завершите приём, затем смените направление',
      );
    }
    if (canReleaseOnBreak(active.ticket.status)) {
      await this.releaseAssignmentForBreak(
        manager,
        active,
        actorSubject,
        'PAUSED',
      );
    } else {
      active.active = false;
      active.completedAt = new Date();
      await manager.save(active);
    }
    await manager.update(Employee, { id: employeeId }, { status: 'OFFLINE' });
  }

  private async releaseEmployeeAssignmentsForDeskChange(
    manager: EntityManager,
    employeeId: string,
    actorSubject: string,
  ): Promise<void> {
    const active = await manager.findOne(Assignment, {
      where: { employee: { id: employeeId }, active: true },
      relations: { ticket: true },
    });
    if (!active) return;
    if (blocksBreak(active.ticket.status)) {
      const employee = await manager.findOneBy(Employee, { id: employeeId });
      throw new ConflictException(
        `${employee?.displayName ?? 'Сотрудник'} обслуживает клиента — сначала завершите талон`,
      );
    }
    if (canReleaseOnBreak(active.ticket.status)) {
      await this.releaseAssignmentForBreak(
        manager,
        active,
        actorSubject,
        'PAUSED',
      );
    } else {
      active.active = false;
      active.completedAt = new Date();
      await manager.save(active);
    }
    await manager.update(Employee, { id: employeeId }, { status: 'PAUSED' });
  }

  private async detachEmployeeDesk(
    manager: EntityManager,
    employeeId: string,
    actorSubject: string,
  ): Promise<void> {
    await this.releaseEmployeeAssignmentsForDeskChange(
      manager,
      employeeId,
      actorSubject,
    );
    const employee = await manager.findOne(Employee, {
      where: { id: employeeId },
    });
    if (!employee) return;
    await manager
      .createQueryBuilder()
      .relation(Employee, 'desk')
      .of(employee.id)
      .set(null);
  }

  private async recoverBreakAssignments(): Promise<number> {
    const stale = await this.dataSource
      .getRepository(Assignment)
      .createQueryBuilder('assignment')
      .innerJoinAndSelect('assignment.ticket', 'ticket')
      .innerJoinAndSelect('assignment.employee', 'employee')
      .where('assignment.active = true')
      .andWhere('employee.status IN (:...statuses)', {
        statuses: ['PAUSED', 'OFFLINE'],
      })
      .andWhere('ticket.status IN (:...ticketStatuses)', {
        ticketStatuses: ['ASSIGNED', 'CALLED'],
      })
      .getMany();
    for (const item of stale) {
      await this.dataSource.transaction(async (manager) => {
        const assignment = await manager.findOne(Assignment, {
          where: { id: item.id, active: true },
          relations: { ticket: true, employee: true },
          lock: { mode: 'pessimistic_write' },
        });
        if (!assignment) return;
        if (!['PAUSED', 'OFFLINE'].includes(assignment.employee.status)) return;
        await this.releaseAssignmentForBreak(
          manager,
          assignment,
          assignment.employee.oidcSubject,
          assignment.employee.status,
        );
      });
    }
    return stale.length;
  }

  private async releaseAssignmentForBreak(
    manager: EntityManager,
    assignment: Assignment,
    actorSubject: string,
    reason: EmployeeStatus,
  ): Promise<void> {
    const ticket = assignment.ticket;
    if (blocksBreak(ticket.status)) {
      throw new ConflictException(
        'Завершите обслуживание клиента перед паузой',
      );
    }
    if (!canReleaseOnBreak(ticket.status)) {
      assignment.active = false;
      assignment.completedAt = new Date();
      await manager.save(assignment);
      return;
    }
    ticket.status = 'REQUEUED';
    ticket.priority = 0;
    assignment.active = false;
    assignment.completedAt = new Date();
    await manager.save([ticket, assignment]);
    await this.event(
      manager,
      ticket.id,
      'REQUEUED',
      { reason: reason === 'PAUSED' ? 'employee-paused' : 'employee-offline' },
      actorSubject,
    );
  }

  private async assignNext(
    manager: EntityManager,
    employee: Employee,
  ): Promise<Assignment | null> {
    const existing = await manager.findOne(Assignment, {
      where: { employee: { id: employee.id }, active: true },
      relations: { ticket: { serviceType: true }, desk: true },
    });
    if (existing) return existing;

    const employeeCountry = employee.country ?? employee.desk?.country;
    if (!employeeCountry || !employee.desk) return null;

    const baseQuery = () =>
      manager
        .getRepository(Ticket)
        .createQueryBuilder('ticket')
        .innerJoinAndSelect('ticket.serviceType', 'serviceType')
        .leftJoinAndSelect('ticket.reservedDesk', 'reservedDesk')
        .where('ticket.siteId = :siteId', { siteId: employee.site?.id })
        .andWhere('ticket.status IN (:...statuses)', {
          statuses: LIVE_QUEUE_STATUSES,
        })
        .andWhere('ticket.country = :country', { country: employeeCountry })
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked');

    let query = baseQuery()
      .andWhere('ticket.reservedDeskId = :deskId', { deskId: employee.desk.id })
      .orderBy('ticket.priority', 'DESC')
      .addOrderBy('ticket.scheduledAt', 'ASC', 'NULLS LAST')
      .addOrderBy('ticket.createdAt', 'ASC')
      .limit(1);

    if (employee.serviceTypeIds?.length) {
      query = query.andWhere('ticket.serviceTypeId IN (:...serviceTypeIds)', {
        serviceTypeIds: employee.serviceTypeIds,
      });
    }

    let ticket = await query.getOne();

    if (!ticket) {
      query = baseQuery()
        .orderBy('ticket.priority', 'DESC')
        .addOrderBy('ticket.scheduledAt', 'ASC', 'NULLS LAST')
        .addOrderBy('ticket.createdAt', 'ASC')
        .limit(1);
      if (employee.serviceTypeIds?.length) {
        query = query.andWhere('ticket.serviceTypeId IN (:...serviceTypeIds)', {
          serviceTypeIds: employee.serviceTypeIds,
        });
      }
      ticket = await query.getOne();
    }

    if (!ticket) return null;
    ticket.status = 'ASSIGNED';
    employee.status = 'RESERVED';
    const assignment = manager.create(Assignment, {
      ticket,
      employee,
      desk: employee.desk,
    });
    await manager.save([ticket, employee, assignment]);
    await this.event(
      manager,
      ticket.id,
      'ASSIGNED',
      { assignmentId: assignment.id, employeeId: employee.id },
      employee.oidcSubject,
    );
    return assignment;
  }

  private async assignSpecificTicket(
    manager: EntityManager,
    ticket: Ticket,
  ): Promise<Assignment | null> {
    if (!LIVE_QUEUE_STATUSES.includes(ticket.status)) return null;
    const employees = await manager.find(Employee, {
      where: { status: 'AVAILABLE' },
      relations: { site: true, desk: true },
      order: { updatedAt: 'ASC' },
    });
    const match =
      employees.find(
        (employee) => employee.desk?.id === ticket.reservedDesk?.id,
      ) ??
      employees.find(
        (employee) =>
          employee.site?.id === ticket.site.id &&
          Boolean(employee.desk) &&
          (employee.country ?? employee.desk?.country) === ticket.country,
      );
    if (!match?.desk) return null;
    ticket.status = 'ASSIGNED';
    match.status = 'RESERVED';
    const assignment = manager.create(Assignment, {
      ticket,
      employee: match,
      desk: match.desk,
    });
    await manager.save([ticket, match, assignment]);
    await this.event(
      manager,
      ticket.id,
      'ASSIGNED',
      { assignmentId: assignment.id, employeeId: match.id },
      match.oidcSubject,
    );
    return assignment;
  }

  private async getQueueMeta(ticket: Ticket) {
    if (!LIVE_QUEUE_STATUSES.includes(ticket.status)) {
      return { queuePosition: 0, estimatedWaitMinutes: 0 };
    }
    const peers = await this.dataSource.getRepository(Ticket).find({
      where: LIVE_QUEUE_STATUSES.map((status) => ({
        site: { id: ticket.site.id },
        status,
      })),
    });
    const rank = (item: Ticket) =>
      item.priority * 1_000_000_000_000 -
      (item.scheduledAt?.getTime() ?? item.createdAt.getTime());
    const ahead = peers.filter((item) => rank(item) > rank(ticket)).length;
    const position = ahead + 1;
    return {
      queuePosition: position,
      estimatedWaitMinutes: Math.max(1, position * 4),
    };
  }

  private toPublic(
    ticket: Ticket,
    service: ServiceType,
    deskLabel?: string,
    queueMeta?: { queuePosition: number; estimatedWaitMinutes: number },
    servedBy?: string,
    lookupCode?: string,
  ) {
    return {
      id: ticket.id,
      number: ticket.number,
      status: ticket.status,
      serviceName: service.name,
      deskLabel,
      createdAt: ticket.createdAt.toISOString(),
      queuePosition: queueMeta?.queuePosition ?? 0,
      estimatedWaitMinutes: queueMeta?.estimatedWaitMinutes ?? 0,
      country: ticket.country,
      fullName: ticket.fullName,
      departureDate: ticket.departureDate,
      arrivalDate: ticket.arrivalDate,
      scheduledAt: ticket.scheduledAt?.toISOString(),
      scheduledLabel: ticket.scheduledAt
        ? this.booking.formatScheduledLabel(ticket.scheduledAt)
        : undefined,
      durationMinutes: ticket.durationMinutes,
      clientNotice: ticket.clientNotice,
      servedBy,
      lookupCode,
      canCheckIn: canCheckIn(
        ticket.status,
        ticket.scheduledAt,
        ticket.durationMinutes,
      ),
      checkedInAt: ticket.checkedInAt?.toISOString(),
    };
  }

  private generateLookupCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => {
      return alphabet[randomBytes(1)[0] % alphabet.length];
    }).join('');
  }

  private hashToken(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private async event(
    manager: EntityManager,
    ticketId: string,
    type: string,
    data: Record<string, unknown>,
    actorSubject?: string,
  ): Promise<void> {
    await manager.save(
      manager.create(TicketEvent, { ticketId, type, data, actorSubject }),
    );
  }

  private async audit(
    manager: EntityManager,
    actorSubject: string,
    action: string,
    targetId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await manager.save(
      manager.create(AuditEvent, { actorSubject, action, targetId, details }),
    );
  }
}
