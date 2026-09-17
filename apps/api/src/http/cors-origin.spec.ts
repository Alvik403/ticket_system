import {
  isAllowedBrowserOrigin,
  parseOriginList,
} from './cors-origin';

describe('isAllowedBrowserOrigin', () => {
  const allowedOrigins = [
    'http://localhost:18080',
    'http://127.0.0.1:18080',
  ];

  it('allows missing origin and configured hosts', () => {
    expect(
      isAllowedBrowserOrigin(undefined, { allowedOrigins, allowLocalAndIp: false }),
    ).toBe(true);
    expect(
      isAllowedBrowserOrigin('http://localhost:18080', {
        allowedOrigins,
        allowLocalAndIp: false,
      }),
    ).toBe(true);
  });

  it('rejects unknown hosts unless local/IP mode is on', () => {
    expect(
      isAllowedBrowserOrigin('http://185.65.201.198:18080', {
        allowedOrigins,
        allowLocalAndIp: false,
      }),
    ).toBe(false);
    expect(
      isAllowedBrowserOrigin('http://185.65.201.198:18080', {
        allowedOrigins,
        allowLocalAndIp: true,
      }),
    ).toBe(true);
    expect(
      isAllowedBrowserOrigin('http://185.65.201.198', {
        allowedOrigins,
        allowLocalAndIp: true,
      }),
    ).toBe(true);
  });

  it('does not treat arbitrary hostnames as LAN', () => {
    expect(
      isAllowedBrowserOrigin('https://evil.example', {
        allowedOrigins,
        allowLocalAndIp: true,
      }),
    ).toBe(false);
  });

  it('parses comma-separated origin lists', () => {
    expect(parseOriginList('http://a', ' http://b,http://c ')).toEqual([
      'http://a',
      'http://b',
      'http://c',
    ]);
  });
});
