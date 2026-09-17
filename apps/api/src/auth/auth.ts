import {
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Logger,
  OnModuleInit,
  Req,
  Res,
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import {
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  buildEndSessionUrl,
  calculatePKCECodeChallenge,
  Configuration,
  discovery,
  fetchUserInfo,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  type ServerMetadata,
} from 'openid-client';
import type { Role } from '../domain/entities';
import {
  originJoin,
  requestPublicOrigin,
  rewriteUrlOrigin,
} from '../http/public-origin';
import { decodeJwtPayload, extractApplicationRoles } from './auth.utils';
import { tokensEqual } from './csrf';
import {
  browserIssuer,
  fetchOidcMetadata,
  rewriteInternalEndpoints,
} from './oidc-discovery';

function saveSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.save((error) =>
      error
        ? reject(
            error instanceof Error ? error : new Error('Session save failed'),
          )
        : resolve(),
    );
  });
}

async function resolveApplicationRoles(
  configuration: Configuration,
  tokens: Awaited<ReturnType<typeof authorizationCodeGrant>>,
  claims: Record<string, unknown>,
): Promise<Role[]> {
  let roles = extractApplicationRoles(claims);
  if (roles.length) return roles;

  if (typeof tokens.access_token === 'string') {
    roles = extractApplicationRoles(decodeJwtPayload(tokens.access_token));
    if (roles.length) return roles;
  }

  if (
    typeof tokens.access_token === 'string' &&
    typeof claims.sub === 'string'
  ) {
    const userinfo = (await fetchUserInfo(
      configuration,
      tokens.access_token,
      claims.sub,
    )) as Record<string, unknown>;
    roles = extractApplicationRoles(userinfo);
  }

  return roles;
}

export interface SessionUser {
  subject: string;
  displayName: string;
  roles: Role[];
}

declare module 'express-session' {
  interface SessionData {
    user?: SessionUser;
    ticketTokenHash?: string;
    ticketHistory?: string[];
    lookupCode?: string;
    csrfToken?: string;
    idToken?: string;
    oidc?: {
      state: string;
      nonce: string;
      verifier: string;
      redirectUri: string;
    };
  }
}

export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.session.user;
    if (!user) throw new UnauthorizedException('Требуется авторизация');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      !tokensEqual(
        request.session.csrfToken,
        request.get('x-csrf-token') ?? undefined,
      )
    ) {
      throw new ForbiddenException('Неверный CSRF-токен');
    }
    const roles =
      this.reflector.getAllAndOverride<Role[]>('roles', [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (roles.length && !roles.some((role) => user.roles.includes(role))) {
      throw new ForbiddenException('Недостаточно прав');
    }
    return true;
  }
}

@Injectable()
export class PublicCsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    if (
      !tokensEqual(
        request.session.csrfToken,
        request.get('x-csrf-token') ?? undefined,
      )
    ) {
      throw new ForbiddenException('Неверный CSRF-токен');
    }
    return true;
  }
}

@Injectable()
export class OidcService implements OnModuleInit {
  private readonly logger = new Logger(OidcService.name);
  private metadataPromise?: Promise<ServerMetadata>;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    void this.getDiscoveredMetadata().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`OIDC discovery not ready yet: ${message}`);
    });
  }

  async getConfiguration(publicOrigin: string): Promise<Configuration> {
    const clientId = this.config.getOrThrow<string>('OIDC_CLIENT_ID');
    const clientSecret = this.config.getOrThrow<string>('OIDC_CLIENT_SECRET');
    const issuer = browserIssuer(publicOrigin);
    const internalIssuer = this.config.get<string>('OIDC_INTERNAL_ISSUER');
    if (!internalIssuer) {
      return discovery(
        new URL(issuer),
        clientId,
        clientSecret,
        undefined,
        issuer.startsWith('http://')
          ? { execute: [allowInsecureRequests] }
          : undefined,
      );
    }

    const discovered = await this.getDiscoveredMetadata();
    const metadata: ServerMetadata = {
      ...discovered,
      ...rewriteInternalEndpoints(discovered, internalIssuer),
      issuer,
      authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
      end_session_endpoint: `${issuer}/protocol/openid-connect/logout`,
    };
    const configuration = new Configuration(metadata, clientId, clientSecret);
    if (issuer.startsWith('http://') || internalIssuer.startsWith('http://')) {
      allowInsecureRequests(configuration);
    }
    return configuration;
  }

  private getDiscoveredMetadata(): Promise<ServerMetadata> {
    if (!this.metadataPromise) {
      this.metadataPromise = this.loadMetadata().catch((error: unknown) => {
        this.metadataPromise = undefined;
        throw error;
      });
    }
    return this.metadataPromise;
  }

  private loadMetadata(): Promise<ServerMetadata> {
    const issuer = this.config.getOrThrow<string>('OIDC_ISSUER');
    const internalIssuer = this.config.get<string>('OIDC_INTERNAL_ISSUER');
    const wellKnown = `${internalIssuer ?? issuer}/.well-known/openid-configuration`;
    return fetchOidcMetadata(wellKnown, { attempts: 20, delayMs: 2000 });
  }
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly oidc: OidcService,
    private readonly config: ConfigService,
  ) {}

  private staffAppUrl(origin: string): string {
    const configured = this.config.getOrThrow<string>('STAFF_APP_URL');
    try {
      return originJoin(origin, new URL(configured).pathname);
    } catch {
      return originJoin(origin, '/staff/');
    }
  }

  private async oidcConfiguration(origin: string): Promise<Configuration> {
    try {
      return await this.oidc.getConfiguration(origin);
    } catch {
      throw new ServiceUnavailableException('Сервис входа временно недоступен');
    }
  }

  @Get('login')
  async login(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const origin = requestPublicOrigin(request);
    const redirectUri = originJoin(origin, '/api/auth/callback');
    const verifier = randomPKCECodeVerifier();
    const state = randomState();
    const nonce = randomNonce();
    request.session.oidc = { verifier, state, nonce, redirectUri };
    await saveSession(request);
    const configuration = await this.oidcConfiguration(origin);
    const url = buildAuthorizationUrl(configuration, {
      redirect_uri: redirectUri,
      scope: 'openid profile email',
      code_challenge: await calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    response.redirect(rewriteUrlOrigin(url.toString(), origin));
  }

  @Get('callback')
  async callback(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const pending = request.session.oidc;
    if (!pending) throw new UnauthorizedException('Сессия входа истекла');
    const origin = requestPublicOrigin(request);
    const callbackUrl = new URL(
      `${origin}${request.originalUrl.startsWith('/') ? '' : '/'}${request.originalUrl}`,
    );
    const tokens = await authorizationCodeGrant(
      await this.oidcConfiguration(origin),
      callbackUrl,
      {
        pkceCodeVerifier: pending.verifier,
        expectedState: pending.state,
        expectedNonce: pending.nonce,
      },
    );
    const claims = tokens.claims();
    if (!claims?.sub)
      throw new UnauthorizedException('Не удалось определить пользователя');
    const configuration = await this.oidcConfiguration(origin);
    const roles = await resolveApplicationRoles(configuration, tokens, claims);
    if (!roles.length)
      throw new ForbiddenException('Нет роли для доступа к системе');
    await new Promise<void>((resolve, reject) => {
      request.session.regenerate((error) =>
        error
          ? reject(
              error instanceof Error
                ? error
                : new Error('Session regeneration failed'),
            )
          : resolve(),
      );
    });
    const displayName =
      typeof claims.name === 'string'
        ? claims.name
        : typeof claims.preferred_username === 'string'
          ? claims.preferred_username
          : claims.sub;
    request.session.user = {
      subject: claims.sub,
      displayName,
      roles,
    };
    if (typeof tokens.id_token === 'string') {
      request.session.idToken = tokens.id_token;
    }
    request.session.csrfToken = randomBytes(24).toString('base64url');
    delete request.session.oidc;
    response.redirect(this.staffAppUrl(origin));
  }

  @Get('me')
  me(@Req() request: Request): SessionUser & { csrfToken: string } {
    if (!request.session.user) {
      throw new UnauthorizedException('Вы не авторизованы');
    }
    if (!request.session.csrfToken) {
      request.session.csrfToken = randomBytes(24).toString('base64url');
    }
    return { ...request.session.user, csrfToken: request.session.csrfToken };
  }

  @Get('logout')
  async logout(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const origin = requestPublicOrigin(request);
    const staffUrl = this.staffAppUrl(origin);
    const idToken = request.session.idToken;
    const secureCookies =
      this.config.get(
        'COOKIE_SECURE',
        this.config.get('NODE_ENV') === 'production' ? 'true' : 'false',
      ) === 'true';

    await new Promise<void>((resolve, reject) => {
      request.session.destroy((error) =>
        error
          ? reject(
              error instanceof Error
                ? error
                : new Error('Session destroy failed'),
            )
          : resolve(),
      );
    });

    response.clearCookie('ticket.sid', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
    });

    try {
      const configuration = await this.oidcConfiguration(origin);
      const logoutUrl = buildEndSessionUrl(configuration, {
        ...(idToken ? { id_token_hint: idToken } : {}),
        post_logout_redirect_uri: staffUrl,
      });
      response.redirect(rewriteUrlOrigin(logoutUrl.toString(), origin));
      return;
    } catch {
      response.redirect(staffUrl);
    }
  }
}
