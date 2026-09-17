import {
  APPLICATION_ROLES,
  decodeJwtPayload,
  extractApplicationRoles,
} from './auth.utils';

describe('auth.utils', () => {
  it('extractApplicationRoles keeps only application roles', () => {
    expect(
      extractApplicationRoles({
        realm_access: { roles: ['ADMIN', 'offline_access', 'EMPLOYEE'] },
      }),
    ).toEqual(['ADMIN', 'EMPLOYEE']);
  });

  it('extractApplicationRoles returns empty when roles missing', () => {
    expect(extractApplicationRoles({})).toEqual([]);
    expect(extractApplicationRoles(undefined)).toEqual([]);
  });

  it('decodeJwtPayload reads realm_access from access token payload', () => {
    const payload = Buffer.from(
      JSON.stringify({ realm_access: { roles: ['ADMIN'] } }),
    ).toString('base64url');
    const token = `header.${payload}.signature`;
    expect(extractApplicationRoles(decodeJwtPayload(token))).toEqual(['ADMIN']);
  });

  it('decodeJwtPayload returns undefined for malformed token', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeUndefined();
  });

  it('APPLICATION_ROLES includes admin, employee and auditor', () => {
    expect(APPLICATION_ROLES).toContain('ADMIN');
    expect(APPLICATION_ROLES).toContain('EMPLOYEE');
    expect(APPLICATION_ROLES).toContain('AUDITOR');
  });
});
