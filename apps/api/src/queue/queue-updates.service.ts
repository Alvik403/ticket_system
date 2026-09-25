import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { filter, Observable, Subject } from 'rxjs';
import { postgresConnectionUrl } from '../http/connection-urls';

@Injectable()
export class QueueUpdatesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueUpdatesService.name);
  private readonly changesSubject = new Subject<string>();
  private client?: Client;
  private reconnectTimer?: NodeJS.Timeout;
  private stopping = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.changesSubject.complete();
    await this.client?.end().catch(() => undefined);
  }

  forTicket(ticketId: string): Observable<string> {
    return this.changesSubject.pipe(
      filter((changedId) => changedId === ticketId),
    );
  }

  allTickets(): Observable<string> {
    return this.changesSubject.asObservable();
  }

  private async connect(): Promise<void> {
    const client = new Client({
      connectionString: postgresConnectionUrl(
        this.config.get<string>('DATABASE_URL'),
        this.config.get<string>('POSTGRES_PASSWORD'),
        this.config.get<string>('POSTGRES_HOST'),
      ),
    });
    client.on('notification', (message) => {
      if (message.channel === 'ticket_updates' && message.payload) {
        this.changesSubject.next(message.payload);
      }
    });
    client.on('error', (error) => {
      this.logger.error(
        'Ticket update listener lost its database connection',
        error,
      );
      this.scheduleReconnect();
    });
    await client.connect();
    await client.query('LISTEN ticket_updates');
    this.client = client;
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      const staleClient = this.client;
      this.client = undefined;
      staleClient?.removeAllListeners();
      void staleClient?.end().catch(() => undefined);
      void this.connect().catch((error: unknown) => {
        this.logger.error('Ticket update listener reconnect failed', error);
        this.scheduleReconnect();
      });
    }, 2_000);
    this.reconnectTimer.unref();
  }
}
