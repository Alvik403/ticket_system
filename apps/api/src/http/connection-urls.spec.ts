import { postgresConnectionUrl, redisConnectionUrl } from './connection-urls';

describe('connection urls', () => {
  it('encodes special characters in docker passwords', () => {
    expect(postgresConnectionUrl(undefined, 'p@ss:word', 'postgres')).toBe(
      'postgresql://ticket:p%40ss%3Aword@postgres:5432/ticket',
    );
    expect(redisConnectionUrl(undefined, 'p@ss:word', 'redis')).toBe(
      'redis://:p%40ss%3Aword@redis:6379',
    );
  });

  it('keeps explicit local urls when password is not set', () => {
    expect(postgresConnectionUrl('postgresql://ticket:ticket@localhost:55432/ticket')).toBe(
      'postgresql://ticket:ticket@localhost:55432/ticket',
    );
    expect(redisConnectionUrl('redis://localhost:56379')).toBe(
      'redis://localhost:56379',
    );
  });
});
