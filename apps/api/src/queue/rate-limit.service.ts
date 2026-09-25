import {
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type RedisClientType } from 'redis';
import { redisConnectionUrl } from '../http/connection-urls';

@Injectable()
export class RateLimitService implements OnModuleInit, OnModuleDestroy {
  private client?: RedisClientType;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.client = createClient({
      url: redisConnectionUrl(
        this.config.get<string>('REDIS_URL'),
        this.config.get<string>('REDIS_PASSWORD'),
        this.config.get<string>('REDIS_HOST'),
      ),
    });
    await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
  }

  async ping(): Promise<void> {
    await this.requireClient().ping();
  }

  async assertCanCreateTicket(clientKey: string): Promise<void> {
    const redis = this.requireClient();
    const cooldownTtl = await redis.ttl(`ticket:cooldown:${clientKey}`);
    if (cooldownTtl > 0) {
      throw new HttpException(
        {
          message: `Подождите ${cooldownTtl} сек. перед получением нового талона`,
          retryAfterSeconds: cooldownTtl,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const hourKey = `ticket:hour:${clientKey}`;
    const created = await redis.incr(hourKey);
    if (created === 1) await redis.expire(hourKey, 3_600);
    if (created > 3) {
      const retryAfterSeconds = await redis.ttl(hourKey);
      throw new HttpException(
        {
          message:
            'Превышен лимит талонов с этого устройства (не более 3 в час)',
          retryAfterSeconds: Math.max(retryAfterSeconds, 60),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordTicketCancelled(clientKey: string): Promise<void> {
    await this.requireClient().set(`ticket:cooldown:${clientKey}`, '1', {
      EX: 300,
    });
  }

  async bindActiveTicket(clientKey: string): Promise<void> {
    await this.requireClient().set(`ticket:bind:${clientKey}`, '1', {
      EX: 86_400,
    });
  }

  async clearActiveTicket(clientKey: string): Promise<void> {
    await this.requireClient().del(`ticket:bind:${clientKey}`);
  }

  async holdSlot(
    sessionId: string,
    deskId: string,
    scheduledAt: string,
    holdId: string,
    ttlSeconds = 180,
  ): Promise<boolean> {
    const redis = this.requireClient();
    const key = this.holdKey(deskId, scheduledAt);
    const created = await redis.set(key, `${sessionId}:${holdId}`, {
      NX: true,
      EX: ttlSeconds,
    });
    if (!created) {
      const current = await redis.get(key);
      const owned = current?.startsWith(`${sessionId}:`) ?? false;
      if (owned) {
        const ttl = await redis.ttl(key);
        await redis.zAdd('slot:holds', {
          score: Date.now() + Math.max(ttl, 1) * 1000,
          value: key,
        });
        await redis.expire('slot:holds', 86_400);
      }
      return owned;
    }
    const previous = await redis.get(`slot:session:${sessionId}`);
    if (previous && previous !== key) {
      await redis.multi().del(previous).zRem('slot:holds', previous).exec();
    }
    await redis
      .multi()
      .set(`slot:session:${sessionId}`, key, { EX: ttlSeconds })
      .zAdd('slot:holds', {
        score: Date.now() + ttlSeconds * 1000,
        value: key,
      })
      .expire('slot:holds', 86_400)
      .exec();
    return true;
  }

  async hasRefreshedHold(sessionId: string): Promise<boolean> {
    return Boolean(await this.requireClient().get(`slot:refresh:${sessionId}`));
  }

  async refreshHold(
    sessionId: string,
    holdId: string,
    ttlSeconds = 180,
  ): Promise<boolean> {
    const redis = this.requireClient();
    const key = await redis.get(`slot:session:${sessionId}`);
    if (!key) return false;
    const value = await redis.get(key);
    if (value !== `${sessionId}:${holdId}`) return false;
    const refreshed = await redis.get(`slot:refresh:${sessionId}`);
    if (refreshed) return false;
    await redis
      .multi()
      .expire(key, ttlSeconds)
      .expire(`slot:session:${sessionId}`, ttlSeconds)
      .set(`slot:refresh:${sessionId}`, '1', { EX: ttlSeconds })
      .zAdd('slot:holds', {
        score: Date.now() + ttlSeconds * 1000,
        value: key,
      })
      .expire('slot:holds', 86_400)
      .exec();
    return true;
  }

  async consumeHold(
    sessionId: string,
    holdId: string,
    deskId: string,
    scheduledAt: string,
  ): Promise<boolean> {
    const redis = this.requireClient();
    const key = this.holdKey(deskId, scheduledAt);
    const value = await redis.get(key);
    if (value !== `${sessionId}:${holdId}`) return false;
    await redis
      .multi()
      .del(key)
      .del(`slot:session:${sessionId}`)
      .del(`slot:refresh:${sessionId}`)
      .zRem('slot:holds', key)
      .exec();
    return true;
  }

  async getSessionHold(
    sessionId: string,
  ): Promise<{ deskId: string; scheduledAt: string; holdId: string } | null> {
    const redis = this.requireClient();
    const key = await redis.get(`slot:session:${sessionId}`);
    if (!key) return null;
    const value = await redis.get(key);
    if (!value?.startsWith(`${sessionId}:`)) return null;
    const parsed = this.parseHoldKey(key);
    if (!parsed) return null;
    return { ...parsed, holdId: value.slice(sessionId.length + 1) };
  }

  async peekHold(
    sessionId: string,
    holdId: string,
  ): Promise<{ deskId: string; scheduledAt: string } | null> {
    const redis = this.requireClient();
    const key = await redis.get(`slot:session:${sessionId}`);
    if (!key) return null;
    const value = await redis.get(key);
    if (value !== `${sessionId}:${holdId}`) return null;
    return this.parseHoldKey(key);
  }

  async holdTtl(deskId: string, scheduledAt: string): Promise<number> {
    return this.requireClient().ttl(this.holdKey(deskId, scheduledAt));
  }

  async heldDeskIds(
    startMs: number,
    endMs: number,
    durationMinutes = 20,
  ): Promise<Set<string>> {
    const busy = new Set<string>();
    for (const hold of await this.listHolds()) {
      const holdStart = new Date(hold.scheduledAt).getTime();
      if (Number.isNaN(holdStart)) continue;
      const holdEnd = holdStart + durationMinutes * 60_000;
      if (startMs < holdEnd && endMs > holdStart) busy.add(hold.deskId);
    }
    return busy;
  }

  async listHolds(): Promise<Array<{ deskId: string; scheduledAt: string }>> {
    const redis = this.requireClient();
    await redis.zRemRangeByScore('slot:holds', 0, Date.now());
    const keys = await redis.zRange('slot:holds', 0, -1);
    return keys.flatMap((key) => {
      const parsed = this.parseHoldKey(key);
      return parsed ? [parsed] : [];
    });
  }

  async getIdempotent(subject: string, key: string): Promise<string | null> {
    return this.requireClient().get(`idem:${subject}:${key}`);
  }

  async setIdempotent(
    subject: string,
    key: string,
    payload: string,
  ): Promise<void> {
    await this.requireClient().set(`idem:${subject}:${key}`, payload, {
      EX: 86_400,
    });
  }

  private holdKey(deskId: string, scheduledAt: string): string {
    return `slot:hold:${deskId}:${scheduledAt}`;
  }

  private parseHoldKey(
    key: string,
  ): { deskId: string; scheduledAt: string } | null {
    const [, , deskId, ...rest] = key.split(':');
    if (!deskId || !rest.length) return null;
    return { deskId, scheduledAt: rest.join(':') };
  }

  private requireClient(): RedisClientType {
    if (!this.client) throw new Error('Redis is not connected');
    return this.client;
  }
}
