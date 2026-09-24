import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';

type KeycloakUser = {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  enabled?: boolean;
};

@Injectable()
export class KeycloakAdminService {
  private readonly logger = new Logger(KeycloakAdminService.name);
  private tokenCache: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  private adminBaseUrl(): string {
    const explicit = this.config.get<string>('KEYCLOAK_ADMIN_URL');
    if (explicit) return explicit.replace(/\/$/, '');
    const internalIssuer =
      this.config.get<string>('OIDC_INTERNAL_ISSUER') ??
      this.config.get<string>('OIDC_ISSUER');
    if (!internalIssuer) {
      throw new ServiceUnavailableException('Keycloak не настроен');
    }
    return internalIssuer.replace(/\/realms\/[^/]+$/, '');
  }

  private realm(): string {
    const issuer =
      this.config.get<string>('OIDC_INTERNAL_ISSUER') ??
      this.config.get<string>('OIDC_ISSUER');
    const match = issuer?.match(/\/realms\/([^/]+)$/);
    return match?.[1] ?? 'ticket-system';
  }

  private async adminToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 30_000) {
      return this.tokenCache.value;
    }
    const username =
      this.config.get<string>('KC_BOOTSTRAP_ADMIN_USERNAME') ?? 'admin';
    const password =
      this.config.get<string>('KC_BOOTSTRAP_ADMIN_PASSWORD') ?? 'change-me';
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username,
      password,
    });
    const response = await fetch(
      `${this.adminBaseUrl()}/realms/master/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      },
    );
    if (!response.ok) {
      this.logger.error(`Keycloak admin auth failed: HTTP ${response.status}`);
      throw new ServiceUnavailableException(
        'Не удалось подключиться к Keycloak',
      );
    }
    const payload = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.tokenCache = {
      value: payload.access_token,
      expiresAt: Date.now() + payload.expires_in * 1000,
    };
    return payload.access_token;
  }

  private async adminFetch(
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    const token = await this.adminToken();
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${token}`);
    if (init?.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return fetch(`${this.adminBaseUrl()}${path}`, { ...init, headers });
  }

  generateTemporaryPassword(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const specials = '!@#$%';
    const core = Array.from({ length: 10 }, () => {
      return alphabet[randomBytes(1)[0] % alphabet.length];
    }).join('');
    return `${core}${specials[randomBytes(1)[0] % specials.length]}9`;
  }

  async listEmployeeUsers(): Promise<KeycloakUser[]> {
    const realm = this.realm();
    const roleRes = await this.adminFetch(
      `/admin/realms/${realm}/roles/EMPLOYEE`,
    );
    if (!roleRes.ok) {
      throw new ServiceUnavailableException('Роль EMPLOYEE не найдена');
    }
    const role = (await roleRes.json()) as { id: string; name: string };
    const usersRes = await this.adminFetch(
      `/admin/realms/${realm}/roles/${role.name}/users?max=200`,
    );
    if (!usersRes.ok) {
      throw new ServiceUnavailableException('Не удалось загрузить сотрудников');
    }
    return (await usersRes.json()) as KeycloakUser[];
  }

  async createEmployeeUser(input: {
    username: string;
    firstName: string;
    lastName: string;
    email?: string;
  }): Promise<{ userId: string; username: string; temporaryPassword: string }> {
    const realm = this.realm();
    const username = input.username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
      throw new BadRequestException(
        'Логин: 3–40 символов, латиница, цифры, . _ -',
      );
    }
    const temporaryPassword = this.generateTemporaryPassword();
    const createRes = await this.adminFetch(`/admin/realms/${realm}/users`, {
      method: 'POST',
      body: JSON.stringify({
        username,
        email: input.email?.trim() || `${username}@example.com`,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        enabled: true,
        emailVerified: true,
        requiredActions: ['UPDATE_PASSWORD'],
        credentials: [
          {
            type: 'password',
            value: temporaryPassword,
            temporary: true,
          },
        ],
      }),
    });
    if (createRes.status === 409) {
      throw new ConflictException(
        'Пользователь с таким логином уже существует',
      );
    }
    if (!createRes.ok) {
      this.logger.error(
        `Keycloak create user failed: HTTP ${createRes.status}`,
      );
      throw new ServiceUnavailableException('Не удалось создать пользователя');
    }
    const location = createRes.headers.get('location') ?? '';
    const userId = location.split('/').pop();
    if (!userId) {
      throw new ServiceUnavailableException(
        'Keycloak не вернул id пользователя',
      );
    }
    const roleRes = await this.adminFetch(
      `/admin/realms/${realm}/roles/EMPLOYEE`,
    );
    if (!roleRes.ok) {
      throw new ServiceUnavailableException('Роль EMPLOYEE не найдена');
    }
    const role = (await roleRes.json()) as { id: string; name: string };
    const mapRes = await this.adminFetch(
      `/admin/realms/${realm}/users/${userId}/role-mappings/realm`,
      {
        method: 'POST',
        body: JSON.stringify([role]),
      },
    );
    if (!mapRes.ok) {
      throw new ServiceUnavailableException(
        'Не удалось назначить роль EMPLOYEE',
      );
    }
    return { userId, username, temporaryPassword };
  }

  async resetUserPassword(
    userId: string,
  ): Promise<{ temporaryPassword: string }> {
    const realm = this.realm();
    const temporaryPassword = this.generateTemporaryPassword();
    const resetRes = await this.adminFetch(
      `/admin/realms/${realm}/users/${userId}/reset-password`,
      {
        method: 'PUT',
        body: JSON.stringify({
          type: 'password',
          value: temporaryPassword,
          temporary: true,
        }),
      },
    );
    if (!resetRes.ok) {
      throw new ServiceUnavailableException('Не удалось сбросить пароль');
    }
    const userRes = await this.adminFetch(
      `/admin/realms/${realm}/users/${userId}`,
    );
    if (userRes.ok) {
      const user = (await userRes.json()) as {
        requiredActions?: string[];
      };
      const actions = new Set(user.requiredActions ?? []);
      actions.add('UPDATE_PASSWORD');
      await this.adminFetch(`/admin/realms/${realm}/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({
          requiredActions: [...actions],
        }),
      });
    }
    return { temporaryPassword };
  }
}
