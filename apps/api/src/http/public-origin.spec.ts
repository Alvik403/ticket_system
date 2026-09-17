import type { Request } from 'express';
import {
  originJoin,
  requestPublicOrigin,
  rewriteUrlOrigin,
} from './public-origin';

function fakeRequest(headers: Record<string, string>, protocol = 'http') {
  return {
    protocol,
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  } as Request;
}

describe('requestPublicOrigin', () => {
  it('prefers forwarded host and proto from nginx', () => {
    expect(
      requestPublicOrigin(
        fakeRequest({
          host: 'api:3000',
          'x-forwarded-host': '185.65.201.198:18080',
          'x-forwarded-proto': 'http',
        }),
      ),
    ).toBe('http://185.65.201.198:18080');
  });

  it('falls back to Host when forwarded headers are absent', () => {
    expect(
      requestPublicOrigin(
        fakeRequest({
          host: 'localhost:18080',
        }),
      ),
    ).toBe('http://localhost:18080');
  });
});

describe('rewriteUrlOrigin', () => {
  it('keeps path and query on the public host', () => {
    expect(
      rewriteUrlOrigin(
        'http://localhost:18080/realms/ticket-system/protocol/openid-connect/auth?client_id=ticket-staff',
        'http://185.65.201.198:18080',
      ),
    ).toBe(
      'http://185.65.201.198:18080/realms/ticket-system/protocol/openid-connect/auth?client_id=ticket-staff',
    );
  });
});

describe('originJoin', () => {
  it('joins origin and path without double slashes', () => {
    expect(originJoin('http://185.65.201.198:18080/', '/staff/')).toBe(
      'http://185.65.201.198:18080/staff/',
    );
  });
});
