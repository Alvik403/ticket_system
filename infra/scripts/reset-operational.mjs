import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://ticket:ticket@localhost:55432/ticket';
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:56379';
const kcAdmin = process.env.KC_BOOTSTRAP_ADMIN_PASSWORD ?? 'change-me';

function genPassword(prefix) {
  const tail = randomBytes(9).toString('base64url');
  return `${prefix}-${tail}!`;
}

function sh(command) {
  execSync(command, { stdio: 'inherit', cwd: root });
}

function shOut(command) {
  return execSync(command, { encoding: 'utf8', cwd: root }).trim();
}

async function flushRedis() {
  try {
    sh('docker compose -f infra/docker-compose.yml exec -T redis redis-cli FLUSHDB');
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
}

async function waitKeycloakReady(maxAttempts = 40) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      execSync('curl.exe -sf http://localhost:18081/health/ready', {
        stdio: 'pipe',
        cwd: root,
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  throw new Error('Keycloak не поднялся вовремя');
}

function kcadm(args) {
  return shOut(
    `docker compose -f infra/docker-compose.yml exec -T keycloak /opt/keycloak/bin/kcadm.sh ${args}`,
  );
}

const sql = readFileSync(join(__dirname, 'reset-operational.sql'), 'utf8');
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query(sql);
  const desks = await client.query(`SELECT COUNT(*)::int AS n FROM desk`);
  const services = await client.query(`SELECT COUNT(*)::int AS n FROM service_type`);
  console.log(
    `Очередь сохранена: столов ${desks.rows[0]?.n ?? 0}, услуг ${services.rows[0]?.n ?? 0}`,
  );
} finally {
  await client.end();
}

await flushRedis();

try {
  sh('docker compose -f infra/docker-compose.yml restart keycloak');
  await waitKeycloakReady();
} catch (error) {
  console.warn('Keycloak restart skipped:', error.message);
}

const adminPassword = genPassword('Admin');
const staffPassword = genPassword('Staff');
const auditorPassword = genPassword('Audit');

try {
  kcadm(
    `config credentials --server http://127.0.0.1:8080 --realm master --user admin --password "${kcAdmin}"`,
  );
  for (const [username, password] of [
    ['admin', adminPassword],
    ['rf1', staffPassword],
    ['rf2', staffPassword],
    ['cn1', staffPassword],
    ['auditor', auditorPassword],
  ]) {
    kcadm(
      `set-password -r ticket-system --username ${username} --new-password "${password}"`,
    );
  }
} catch (error) {
  console.error('Не удалось сменить пароли Keycloak:', error.message);
  process.exitCode = 1;
}

try {
  sh('docker compose -f infra/docker-compose.yml restart api');
} catch {
  console.warn('API restart skipped');
}

console.log('\n=== Новые учётные данные (Keycloak) ===');
console.log(`admin   / ${adminPassword}`);
console.log(`rf1     / ${staffPassword}`);
console.log(`rf2     / ${staffPassword}`);
console.log(`cn1     / ${staffPassword}`);
console.log(`auditor / ${auditorPassword}`);
console.log('\nStaff: http://localhost:18080/staff/');
console.log('После входа админу: назначить направление РФ/Загран менеджерам в «Менеджеры».');
console.log('OPERATIONAL_RESET_OK');
