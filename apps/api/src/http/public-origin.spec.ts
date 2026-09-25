import type { Request } from 'express';
import {
  originJoin,
  requestPublicOrigin,
  rewriteUrlOrigin,
  staffAppUrl,
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
          'x-forwarded-host': 'queue.example:18080',
          'x-forwarded-proto': 'http',
        }),
      ),
    ).toBe('http://queue.example:18080');
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

  it('keeps login on http when a trusted cookie is not required', () => {
    expect(
      requestPublicOrigin(
        fakeRequest({
          host: '94.231.221.214:18080',
          'x-forwarded-proto': 'https',
        }),
        { forceHttp: true },
      ),
    ).toBe('http://94.231.221.214:18080');
  });
});

describe('rewriteUrlOrigin', () => {
  it('keeps path and query on the public host', () => {
    expect(
      rewriteUrlOrigin(
        'http://localhost:18080/realms/ticket-system/protocol/openid-connect/auth?client_id=ticket-staff',
        'http://queue.example:18080',
      ),
    ).toBe(
      'http://queue.example:18080/realms/ticket-system/protocol/openid-connect/auth?client_id=ticket-staff',
    );
  });
});

describe('originJoin', () => {
  it('joins origin and path without double slashes', () => {
    expect(originJoin('http://queue.example:18080/', '/staff/')).toBe(
      'http://queue.example:18080/staff/',
    );
  });
});

describe('staffAppUrl', () => {
  it('keeps staff on /staff/ when env points at a Vite origin', () => {
    expect(
      staffAppUrl('http://94.231.221.214:18080', 'http://localhost:5174'),
    ).toBe('http://94.231.221.214:18080/staff/');
  });

  it('uses the configured staff path on the request host', () => {
    expect(
      staffAppUrl(
        'http://94.231.221.214:18080',
        'http://localhost:18080/staff/',
      ),
    ).toBe('http://94.231.221.214:18080/staff/');
  });
});
