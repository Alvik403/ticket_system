import { clientIp } from './client-ip';

describe('clientIp', () => {
  it('uses X-Real-IP from the trusted proxy', () => {
    expect(
      clientIp({
        headers: { 'x-real-ip': '203.0.113.10' },
        socket: { remoteAddress: '10.0.0.2' },
      } as never),
    ).toBe('203.0.113.10');
  });

  it('ignores client-supplied X-Forwarded-For', () => {
    expect(
      clientIp({
        headers: {
          'x-forwarded-for': '198.51.100.1, 203.0.113.10',
        },
        socket: { remoteAddress: '10.0.0.2' },
      } as never),
    ).toBe('10.0.0.2');
  });

  it('rejects a comma-separated X-Real-IP header', () => {
    expect(
      clientIp({
        headers: { 'x-real-ip': '198.51.100.1, 203.0.113.10' },
        socket: { remoteAddress: '10.0.0.2' },
      } as never),
    ).toBe('10.0.0.2');
  });
});
