import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, LessThan } from 'typeorm';
import {
  Assignment,
  AuditEvent,
  Ticket,
  TicketEvent,
} from '../domain/entities';

const TERMINAL = ['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;

@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = Number(
      this.config.get('RETENTION_INTERVAL_MS', '3600000'),
    );
    void this.purgeExpired().catch((error: unknown) => {
      this.logger.error('Initial retention purge failed', error);
    });
    this.timer = setInterval(() => {
      void this.purgeExpired().catch((error: unknown) => {
        this.logger.error('Retention purge failed', error);
      });
    }, intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async purgeExpired(): Promise<{ tickets: number; audits: number }> {
    const ticketDays = Number(this.config.get('RETENTION_TICKET_DAYS', '90'));
    const auditDays = Number(this.config.get('RETENTION_AUDIT_DAYS', '365'));
    const ticketCutoff = new Date(Date.now() - ticketDays * 86_400_000);
    const auditCutoff = new Date(Date.now() - auditDays * 86_400_000);

    return this.dataSource.transaction(async (manager) => {
      const expired = await manager
        .getRepository(Ticket)
        .createQueryBuilder('ticket')
        .select(['ticket.id'])
        .where('ticket.status IN (:...statuses)', { statuses: [...TERMINAL] })
        .andWhere('ticket.updatedAt < :cutoff', { cutoff: ticketCutoff })
        .getMany();
      const ids = expired.map((row) => row.id);
      if (ids.length) {
        await manager
          .createQueryBuilder()
          .delete()
          .from(Assignment)
          .where('"ticketId" IN (:...ids)', { ids })
          .execute();
        await manager
          .createQueryBuilder()
          .delete()
          .from(TicketEvent)
          .where('"ticketId" IN (:...ids)', { ids })
          .execute();
        await manager
          .createQueryBuilder()
          .delete()
          .from(Ticket)
          .where('id IN (:...ids)', { ids })
          .execute();
      }
      const auditResult = await manager.getRepository(AuditEvent).delete({
        occurredAt: LessThan(auditCutoff),
      });
      const audits = auditResult.affected ?? 0;
      if (ids.length || audits) {
        this.logger.log(
          `Retention removed ${ids.length} tickets and ${audits} audit rows`,
        );
      }
      return { tickets: ids.length, audits };
    });
  }
}
