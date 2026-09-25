import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected shouldSkip(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ method?: string; originalUrl?: string }>();
    const method = request.method?.toUpperCase();
    return Promise.resolve(
      method === 'HEAD' ||
        method === 'OPTIONS' ||
        request.originalUrl?.endsWith('/events') === true,
    );
  }
}
