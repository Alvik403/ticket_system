import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://ticket:ticket@localhost:55432/ticket';
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:56379';

const sql = readFileSync(join(__dirname, 'reset-data.sql'), 'utf8');
const client = new pg.Client({ connectionString: databaseUrl });

await client.connect();
try {
  await client.query(sql);
  const employees = await client.query(
    `SELECT COUNT(*)::int AS desks FROM desk`,
  );
  console.log('Desks after reset:', employees.rows[0]?.desks ?? 0);
} finally {
  await client.end();
}

try {
  execSync(`docker compose -f infra/docker-compose.yml exec -T redis redis-cli FLUSHDB`, {
    stdio: 'inherit',
    cwd: join(__dirname, '../..'),
  });
} catch {
  try {
    const Redis = (await import('ioredis')).default;
    const redis = new Redis(redisUrl);
    await redis.flushdb();
    await redis.quit();
  } catch (error) {
    console.warn('Redis flush skipped:', error.message);
  }
}

try {
  execSync(`docker compose -f infra/docker-compose.yml up -d --force-recreate keycloak`, {
    stdio: 'inherit',
    cwd: join(__dirname, '../..'),
  });
} catch (error) {
  console.warn('Keycloak recreate skipped:', error.message);
}

try {
  execSync(`docker compose -f infra/docker-compose.yml restart api`, {
    stdio: 'inherit',
    cwd: join(__dirname, '../..'),
  });
} catch (error) {
  console.warn('API restart skipped:', error.message);
}

console.log('DATA_RESET_OK');
