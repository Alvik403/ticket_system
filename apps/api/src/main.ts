import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { RedisStore } from 'connect-redis';
import { createClient } from 'redis';
import { AppModule } from './app.module';
import { isAllowedBrowserOrigin, parseOriginList } from './http/cors-origin';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const redis = createClient({ url: config.getOrThrow<string>('REDIS_URL') });
  const redisLogger = new Logger('Redis');
  redis.on('error', (error: Error) =>
    redisLogger.error('Session store connection error', error),
  );
  await redis.connect();
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set('trust proxy', 1);
  app.setGlobalPrefix('api');
  const allowedOrigins = parseOriginList(
    config.getOrThrow<string>('CLIENT_ORIGIN'),
    config.getOrThrow<string>('STAFF_ORIGIN'),
    config.get('PUBLIC_ORIGIN'),
  );
  const allowAnyHttpOrigin =
    config.get(
      'ALLOW_LOCALHOST_CORS',
      config.get('NODE_ENV') === 'production' ? 'false' : 'true',
    ) === 'true';
  app.enableCors({
    origin(
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) {
      callback(
        null,
        isAllowedBrowserOrigin(origin, { allowedOrigins, allowAnyHttpOrigin }),
      );
    },
    credentials: true,
  });
  const secureCookies =
    config.get(
      'COOKIE_SECURE',
      config.get('NODE_ENV') === 'production' ? 'true' : 'false',
    ) === 'true';
  app.use(
    helmet({
      strictTransportSecurity: secureCookies ? undefined : false,
    }),
  );
  app.use(cookieParser());
  app.use(
    session({
      name: 'ticket.sid',
      secret: config.getOrThrow<string>('SESSION_SECRET'),
      store: new RedisStore({ client: redis, prefix: 'ticket:session:' }),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: secureCookies,
        sameSite: 'lax',
        maxAge: 8 * 60 * 60 * 1000,
      },
    }),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const enableOpenApi =
    config.get(
      'ENABLE_OPENAPI',
      config.get('NODE_ENV') === 'production' ? 'false' : 'true',
    ) === 'true';
  if (enableOpenApi) {
    const openApi = new DocumentBuilder()
      .setTitle('API электронной очереди')
      .setDescription(
        'Публичная очередь и операции для сотрудников и администраторов',
      )
      .setVersion('0.1.0')
      .addCookieAuth('ticket.sid')
      .build();
    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(app, openApi),
    );
  }
  await app.listen(config.get<number>('PORT', 3000));
}
void bootstrap();
