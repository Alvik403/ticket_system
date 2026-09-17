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
      isAllowedBrowserOrigin(undefined, {
        allowedOrigins,
        allowAnyHttpOrigin: false,
      }),
    ).toBe(true);
    expect(
      isAllowedBrowserOrigin('http://localhost:18080', {
        allowedOrigins,
        allowAnyHttpOrigin: false,
      }),
    ).toBe(true);
  });

  it('allows any http origin in LAN deploy mode', () => {
    expect(
      isAllowedBrowserOrigin('http://queue.example:18080', {
        allowedOrigins,
        allowAnyHttpOrigin: false,
      }),
    ).toBe(false);
    expect(
      isAllowedBrowserOrigin('http://queue.example:18080', {
        allowedOrigins,
        allowAnyHttpOrigin: true,
      }),
    ).toBe(true);
    expect(
      isAllowedBrowserOrigin('http://desk-2.example:18080', {
        allowedOrigins,
        allowAnyHttpOrigin: true,
      }),
    ).toBe(true);
  });

  it('rejects non-http origins even in LAN deploy mode', () => {
    expect(
      isAllowedBrowserOrigin('javascript:alert(1)', {
        allowedOrigins,
        allowAnyHttpOrigin: true,
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
