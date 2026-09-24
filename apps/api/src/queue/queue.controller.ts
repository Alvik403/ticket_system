import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  MessageEvent,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { from, map, Observable, startWith, switchMap } from 'rxjs';
import { PublicCsrfGuard, Roles, SessionGuard } from '../auth/auth';
import { clientIp } from '../http/client-ip';
import {
  AssignEmployeeDeskDto,
  AssignmentActionDto,
  CreateBlockedSlotDto,
  CreateDeskDto,
  CreateManagerDto,
  CreateTicketDto,
  EmployeeSelfDeskDto,
  EmployeeStatusDto,
  HoldSlotDto,
  LookupTicketDto,
  RefreshHoldDto,
  RescheduleTicketDto,
  SetTicketStatusDto,
  UpdateDeskDto,
  UpdateEmployeeCountryDto,
} from './queue.dto';
import { BookingService } from './booking.service';
import { QueueService } from './queue.service';
import { QueueUpdatesService } from './queue-updates.service';
import { RateLimitService } from './rate-limit.service';

function queryString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

@ApiTags('public')
@UseGuards(PublicCsrfGuard)
@Controller('public')
export class PublicQueueController {
  constructor(
    private readonly queue: QueueService,
    private readonly booking: BookingService,
    private readonly rateLimit: RateLimitService,
    private readonly updates: QueueUpdatesService,
  ) {}

  private async findActiveTicket(request: Request) {
    const tokenHash = request.session.ticketTokenHash;
    if (!tokenHash) return null;
    const current = await this.queue
      .getPublicTicketByHash(tokenHash)
      .catch(() => null);
    if (
      !current ||
      ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(current.status)
    ) {
      await this.rateLimit.clearActiveTicket(clientIp(request));
      delete request.session.ticketTokenHash;
      delete request.session.lookupCode;
      return null;
    }
    return { tokenHash, current };
  }

  @Get('csrf')
  csrf(@Req() request: Request) {
    if (!request.session.csrfToken) {
      request.session.csrfToken = randomBytes(24).toString('base64url');
    }
    return { csrfToken: request.session.csrfToken };
  }

  @Get('sites')
  sites() {
    return this.queue.getCatalog();
  }

  @Get('sites/:siteId/services')
  services(@Param('siteId') siteId: string) {
    return this.queue.getServices(siteId);
  }

  @Get('booking/dates')
  bookingDates() {
    return this.booking.getAvailableDates();
  }

  @Get('sites/:siteId/slots')
  slots(@Param('siteId') siteId: string, @Req() request: Request) {
    const date = queryString(request.query.date);
    const country = queryString(request.query.country, 'RF');
    if (!date || !['RF', 'CN'].includes(country)) {
      return [];
    }
    return this.booking.listAvailableSlots(
      siteId,
      date,
      country as 'RF' | 'CN',
    );
  }

  @Post('slots/hold')
  holdSlot(@Req() request: Request, @Body() body: HoldSlotDto) {
    return this.queue.holdSlot(
      request.sessionID,
      body.siteId,
      body.country,
      body.scheduledAt,
    );
  }

  @Post('slots/hold/refresh')
  refreshHold(@Req() request: Request, @Body() body: RefreshHoldDto) {
    return this.queue.refreshHold(request.sessionID, body.holdId);
  }

  @Get('schedule')
  schedule(@Req() request: Request) {
    const siteId = queryString(request.query.siteId);
    const date = queryString(request.query.date);
    if (!siteId || !date) return [];
    return this.booking.getDaySchedule(siteId, date);
  }

  @Get('tickets/history')
  async history(@Req() request: Request) {
    const hashes = request.session.ticketHistory ?? [];
    return this.queue.getTicketHistory(hashes);
  }

  @Post('tickets')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async create(@Req() request: Request, @Body() body: CreateTicketDto) {
    if (body.website) {
      return { ignored: true };
    }
    const key = clientIp(request);
    await this.rateLimit.assertCanCreateTicket(key);
    const existing = await this.findActiveTicket(request);
    if (existing) {
      return existing.current;
    }
    const created = await this.queue.createTicket({
      siteId: body.siteId,
      serviceTypeId: body.serviceTypeId,
      country: body.country,
      fullName: body.fullName,
      departureDate: body.departureDate,
      arrivalDate: body.arrivalDate,
      scheduledAt: body.scheduledAt,
      sessionId: request.sessionID,
      holdId: body.holdId,
    });
    request.session.ticketTokenHash = created.tokenHash;
    request.session.lookupCode = created.lookupCode;
    request.session.ticketHistory = [
      created.tokenHash,
      ...(request.session.ticketHistory ?? []),
    ].slice(0, 30);
    await this.rateLimit.bindActiveTicket(key);
    return created.ticket;
  }

  @Post('tickets/lookup')
  async lookup(@Req() request: Request, @Body() body: LookupTicketDto) {
    const found = await this.queue.lookupTicket(body.number, body.lookupCode);
    request.session.ticketTokenHash = found.tokenHash;
    request.session.lookupCode = body.lookupCode.trim().toUpperCase();
    request.session.ticketHistory = [
      found.tokenHash,
      ...(request.session.ticketHistory ?? []),
    ].slice(0, 30);
    return found.ticket;
  }

  @Post('tickets/current/check-in')
  async checkIn(@Req() request: Request) {
    const active = await this.findActiveTicket(request);
    if (!active) return null;
    return this.queue.checkInByHash(active.tokenHash);
  }

  @Get('tickets/current')
  async current(@Req() request: Request) {
    const active = await this.findActiveTicket(request);
    if (!active) return null;
    return {
      ...active.current,
      lookupCode: request.session.lookupCode,
    };
  }

  @Delete('tickets/current')
  async cancel(@Req() request: Request) {
    const active = await this.findActiveTicket(request);
    if (!active) return null;
    await this.queue.cancelTicketByHash(active.tokenHash);
    await this.rateLimit.recordTicketCancelled(clientIp(request));
    await this.rateLimit.clearActiveTicket(clientIp(request));
    delete request.session.ticketTokenHash;
    delete request.session.lookupCode;
    return { cancelled: true };
  }

  @Sse('tickets/events')
  events(@Req() request: Request): Observable<MessageEvent> {
    return from(Promise.resolve(request.session.ticketTokenHash)).pipe(
      switchMap((tokenHash) => {
        if (!tokenHash) {
          return from([{ data: { error: 'Нет активного талона' } }]);
        }
        return this.updates.changes.pipe(
          startWith(undefined),
          switchMap(() => this.queue.getPublicTicketByHash(tokenHash)),
          map((data) => ({ data })),
        );
      }),
    );
  }
}

@ApiTags('employee')
@ApiCookieAuth()
@UseGuards(SessionGuard)
@Roles('EMPLOYEE', 'ADMIN')
@Controller('employee')
export class EmployeeQueueController {
  constructor(
    private readonly queue: QueueService,
    private readonly rateLimit: RateLimitService,
    private readonly updates: QueueUpdatesService,
  ) {}

  @Get('current')
  current(@Req() request: Request) {
    return this.queue.getCurrent(request.session.user!);
  }

  @Get('bookings')
  bookings(@Req() request: Request) {
    const date = queryString(request.query.date);
    if (!date) {
      return [];
    }
    return this.queue.listEmployeeBookings(request.session.user!, date);
  }

  @Get('desks')
  desks(@Req() request: Request) {
    return this.queue.listEmployeeDesks(request.session.user!);
  }

  @Patch('desk')
  desk(@Req() request: Request, @Body() body: EmployeeSelfDeskDto) {
    return this.queue.assignSelfDesk(
      request.session.user!,
      body.deskId ?? null,
    );
  }

  @Sse('events')
  events(@Req() request: Request): Observable<MessageEvent> {
    const user = request.session.user!;
    return this.updates.changes.pipe(
      startWith(undefined),
      switchMap(() => this.queue.getCurrent(user)),
      map((data) => ({ data })),
    );
  }

  @Patch('status')
  status(@Req() request: Request, @Body() body: EmployeeStatusDto) {
    return this.queue.setEmployeeStatus(request.session.user!, body.status);
  }

  @Patch('tickets/:id/reschedule')
  reschedule(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: RescheduleTicketDto,
  ) {
    return this.queue.rescheduleTicket(
      request.session.user!,
      id,
      body.scheduledAt,
    );
  }

  @Post('tickets/:id/no-show')
  markNoShow(@Req() request: Request, @Param('id') id: string) {
    return this.queue.markNoShow(request.session.user!, id);
  }

  @Patch('tickets/:id/status')
  setTicketStatus(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: SetTicketStatusDto,
  ) {
    return this.queue.setTicketStatus(request.session.user!, id, body.status);
  }

  @Post('assignments/:id/action')
  async action(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: AssignmentActionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const user = request.session.user!;
    const key = idempotencyKey?.trim();
    if (key && key.length <= 128) {
      const cached = await this.rateLimit.getIdempotent(user.subject, key);
      if (cached) return JSON.parse(cached) as unknown;
    }
    const result = await this.queue.assignmentAction(
      user,
      id,
      body.action,
      body.reason,
    );
    if (key && key.length <= 128) {
      await this.rateLimit.setIdempotent(
        user.subject,
        key,
        JSON.stringify(result),
      );
    }
    return result;
  }
}

@ApiTags('admin')
@ApiCookieAuth()
@UseGuards(SessionGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminQueueController {
  constructor(
    private readonly queue: QueueService,
    private readonly booking: BookingService,
  ) {}

  @Get('blocked-slots')
  blockedSlots(@Req() request: Request) {
    const siteId = queryString(request.query.siteId);
    if (!siteId) return [];
    return this.booking.listBlockedSlots(siteId);
  }

  @Post('blocked-slots')
  createBlockedSlot(
    @Req() request: Request,
    @Body() body: CreateBlockedSlotDto,
  ) {
    return this.booking.createBlockedSlot(
      request.session.user!.subject,
      body.siteId,
      body.employeeId,
      body.date,
      body.startTime,
      body.endTime,
      body.reason,
    );
  }

  @Delete('blocked-slots/:id')
  deleteBlockedSlot(@Req() request: Request, @Param('id') id: string) {
    return this.booking.deleteBlockedSlot(id, request.session.user!.subject);
  }

  @Get('queue')
  activeQueue(@Req() request: Request) {
    return this.queue.adminQueue(request.session.user!.subject);
  }

  @Get('metrics/overview')
  metricsOverview(@Req() request: Request) {
    return this.queue.metricsOverview(request.session.user!.subject);
  }

  @Get('metrics/employees')
  employeeMetrics(@Req() request: Request) {
    return this.queue.metrics(request.session.user!.subject);
  }

  @Get('sites')
  sites() {
    return this.queue.listSites();
  }

  @Get('desks')
  desks() {
    return this.queue.listDesks();
  }

  @Post('desks')
  createDesk(@Req() request: Request, @Body() body: CreateDeskDto) {
    return this.queue.createDesk(
      request.session.user!.subject,
      body.label,
      body.siteId,
      body.country,
    );
  }

  @Patch('desks/:id')
  updateDesk(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: UpdateDeskDto,
  ) {
    return this.queue.updateDesk(request.session.user!.subject, id, body);
  }

  @Delete('desks/:id')
  deleteDesk(@Req() request: Request, @Param('id') id: string) {
    return this.queue.deleteDesk(request.session.user!.subject, id);
  }

  @Get('employees')
  employees() {
    return this.queue.listAdminEmployees();
  }

  @Get('managers')
  managers() {
    return this.queue.listManagers();
  }

  @Post('managers')
  createManager(@Req() request: Request, @Body() body: CreateManagerDto) {
    return this.queue.createManager(request.session.user!.subject, body);
  }

  @Post('managers/:keycloakId/reset-password')
  resetManagerPassword(
    @Req() request: Request,
    @Param('keycloakId') keycloakId: string,
  ) {
    return this.queue.resetManagerPassword(
      request.session.user!.subject,
      keycloakId,
    );
  }

  @Patch('managers/:keycloakId/country')
  updateManagerCountry(
    @Req() request: Request,
    @Param('keycloakId') keycloakId: string,
    @Body() body: UpdateEmployeeCountryDto,
  ) {
    return this.queue.updateManagerCountry(
      request.session.user!.subject,
      keycloakId,
      body.country,
    );
  }

  @Patch('employees/:id/desk')
  assignDesk(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: AssignEmployeeDeskDto,
  ) {
    return this.queue.assignEmployeeDesk(
      request.session.user!.subject,
      id,
      body.deskId ?? null,
    );
  }

  @Post('tickets/:id/no-show')
  markNoShow(@Req() request: Request, @Param('id') id: string) {
    return this.queue.markNoShow(request.session.user!, id);
  }

  @Patch('employees/:id/country')
  assignCountry(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: UpdateEmployeeCountryDto,
  ) {
    return this.queue.updateEmployeeCountry(
      request.session.user!.subject,
      id,
      body.country,
    );
  }
}

@ApiTags('auditor')
@ApiCookieAuth()
@UseGuards(SessionGuard)
@Roles('AUDITOR', 'ADMIN')
@Controller('auditor')
export class AuditorQueueController {
  constructor(private readonly queue: QueueService) {}

  @Get('metrics/overview')
  metricsOverview(@Req() request: Request) {
    return this.queue.metricsOverview(request.session.user!.subject);
  }

  @Get('metrics/employees')
  employeeMetrics(@Req() request: Request) {
    return this.queue.metrics(request.session.user!.subject);
  }

  @Get('audit')
  audit(@Req() request: Request, @Query('limit') limit?: string) {
    return this.queue.listAuditEvents(
      request.session.user!.subject,
      Number(limit) || 100,
    );
  }
}
