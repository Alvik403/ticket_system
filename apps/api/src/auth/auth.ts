import {
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Req,
  Res,
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
import { decodeJwtPayload, extractApplicationRoles } from './auth.utils';
import { tokensEqual } from './csrf';

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
    oidc?: { state: string; nonce: string; verifier: string };
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
export class OidcService {
  private configuration?: Promise<Configuration>;

  constructor(private readonly config: ConfigService) {}

  getConfiguration(): Promise<Configuration> {
    if (!this.configuration) {
      this.configuration = this.createConfiguration();
    }
    return this.configuration;
  }

  private async createConfiguration(): Promise<Configuration> {
    const issuer = this.config.getOrThrow<string>('OIDC_ISSUER');
    const internalIssuer = this.config.get<string>('OIDC_INTERNAL_ISSUER');
    const clientId = this.config.getOrThrow<string>('OIDC_CLIENT_ID');
    const clientSecret = this.config.getOrThrow<string>('OIDC_CLIENT_SECRET');
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

    const response = await fetch(
      `${internalIssuer}/.well-known/openid-configuration`,
    );
    if (!response.ok) throw new Error('OIDC discovery failed');
    const discovered = (await response.json()) as ServerMetadata;
    const internalOrigin = new URL(internalIssuer).origin;
    const rewrite = (endpoint?: string): string | undefined => {
      if (!endpoint) return undefined;
      const url = new URL(endpoint);
      return `${internalOrigin}${url.pathname}${url.search}`;
    };
    const metadata: ServerMetadata = {
      ...discovered,
      issuer,
      authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
      end_session_endpoint: `${issuer}/protocol/openid-connect/logout`,
      token_endpoint: rewrite(discovered.token_endpoint),
      jwks_uri: rewrite(discovered.jwks_uri),
      userinfo_endpoint: rewrite(discovered.userinfo_endpoint),
      introspection_endpoint: rewrite(discovered.introspection_endpoint),
      revocation_endpoint: rewrite(discovered.revocation_endpoint),
    };
    const configuration = new Configuration(metadata, clientId, clientSecret);
    if (issuer.startsWith('http://') || internalIssuer.startsWith('http://')) {
      allowInsecureRequests(configuration);
    }
    return configuration;
  }
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly oidc: OidcService,
    private readonly config: ConfigService,
  ) {}

  @Get('login')
  async login(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const verifier = randomPKCECodeVerifier();
    const state = randomState();
    const nonce = randomNonce();
    request.session.oidc = { verifier, state, nonce };
    const configuration = await this.oidc.getConfiguration();
    const url = buildAuthorizationUrl(configuration, {
      redirect_uri: this.config.getOrThrow<string>('OIDC_CALLBACK_URL'),
      scope: 'openid profile email',
      code_challenge: await calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    response.redirect(url.toString());
  }

  @Get('callback')
  async callback(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const pending = request.session.oidc;
    if (!pending) throw new UnauthorizedException('Сессия входа истекла');
    const callbackUrl = new URL(
      `${request.protocol}://${request.get('host')}${request.originalUrl}`,
    );
    const tokens = await authorizationCodeGrant(
      await this.oidc.getConfiguration(),
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
    const configuration = await this.oidc.getConfiguration();
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
    response.redirect(this.config.getOrThrow<string>('STAFF_APP_URL'));
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
    const staffUrl = this.config.getOrThrow<string>('STAFF_APP_URL');
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
      const configuration = await this.oidc.getConfiguration();
      const logoutUrl = buildEndSessionUrl(configuration, {
        ...(idToken ? { id_token_hint: idToken } : {}),
        post_logout_redirect_uri: staffUrl,
      });
      response.redirect(logoutUrl.toString());
      return;
    } catch {
      response.redirect(staffUrl);
    }
  }
}
