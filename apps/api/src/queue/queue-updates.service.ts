import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, Subject, tap } from 'rxjs';

@Injectable()
export class QueueUpdatesService {
  private readonly changesSubject = new Subject<void>();
  readonly changes = this.changesSubject.asObservable();

  notify(): void {
    this.changesSubject.next();
  }
}

@Injectable()
export class QueueUpdatesInterceptor implements NestInterceptor {
  constructor(private readonly updates: QueueUpdatesService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<{ method?: string; originalUrl?: string }>();
    const method = request.method?.toUpperCase();
    const url = request.originalUrl ?? '';
    const mutatesQueue =
      method != null &&
      !['GET', 'HEAD', 'OPTIONS'].includes(method) &&
      !url.includes('/slots/hold') &&
      !url.endsWith('/tickets/lookup') &&
      !url.startsWith('/api/auth/');
    return next.handle().pipe(
      tap(() => {
        if (mutatesQueue) this.updates.notify();
      }),
    );
  }
}
