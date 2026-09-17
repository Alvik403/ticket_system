import type { Role } from '../domain/entities';

export const APPLICATION_ROLES: Role[] = ['EMPLOYEE', 'ADMIN', 'AUDITOR'];

export function extractApplicationRoles(
  source: Record<string, unknown> | undefined,
): Role[] {
  const realmAccess = source?.realm_access as { roles?: string[] } | undefined;
  return (realmAccess?.roles ?? []).filter((role): role is Role =>
    APPLICATION_ROLES.includes(role as Role),
  );
}

export function decodeJwtPayload(
  token: string,
): Record<string, unknown> | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    return JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
