export function postgresConnectionUrl(
  databaseUrl?: string,
  password?: string,
  host?: string,
): string {
  if (password && host) {
    return `postgresql://ticket:${encodeURIComponent(password)}@${host}:5432/ticket`;
  }
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  return databaseUrl;
}

export function redisConnectionUrl(
  redisUrl?: string,
  password?: string,
  host?: string,
): string {
  if (password && host) {
    return `redis://:${encodeURIComponent(password)}@${host}:6379`;
  }
  if (!redisUrl) {
    throw new Error('REDIS_URL is required');
  }
  return redisUrl;
}
