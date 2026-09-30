import pg from 'pg';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const kcAdmin = process.env.KC_BOOTSTRAP_ADMIN_PASSWORD ?? 'change-me';

function kcadmJson(args) {
  try {
    execSync(
      `docker compose -f infra/docker-compose.yml exec -T keycloak /opt/keycloak/bin/kcadm.sh config credentials --server http://127.0.0.1:8080 --realm master --user admin --password "${kcAdmin}"`,
      { cwd: repoRoot, stdio: 'pipe' },
    );
    const raw = execSync(
      `docker compose -f infra/docker-compose.yml exec -T keycloak /opt/keycloak/bin/kcadm.sh ${args}`,
      { encoding: 'utf8', cwd: repoRoot },
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://ticket:ticket@localhost:55432/ticket';

const hashToken = (value) =>
  createHash('sha256').update(value).digest('hex');

const lookupCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(
    { length: 6 },
    () => alphabet[randomBytes(1)[0] % alphabet.length],
  ).join('');
};

function moscowDate(offsetDays = 0) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year').value);
  const month = Number(parts.find((part) => part.type === 'month').value);
  const day = Number(parts.find((part) => part.type === 'day').value);
  const utc = Date.UTC(year, month - 1, day + offsetDays);
  return new Date(utc).toISOString().slice(0, 10);
}

function moscowNowParts() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  return {
    hour: Number(parts.find((part) => part.type === 'hour').value),
    minute: Number(parts.find((part) => part.type === 'minute').value),
  };
}

function slotIso(date, hours, minutes) {
  return `${date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+03:00`;
}

function nextSlotTimes(count, startHour = 8, stepMinutes = 20) {
  const { hour, minute } = moscowNowParts();
  let cursor = Math.max(startHour * 60, hour * 60 + minute + stepMinutes);
  const slots = [];
  for (let index = 0; index < count; index += 1) {
    const total = cursor + index * stepMinutes;
    slots.push({
      hour: Math.floor(total / 60) % 24,
      minute: total % 60,
    });
  }
  return slots;
}

function pastSlotTimes(count, startHour = 8, stepMinutes = 20) {
  const { hour, minute } = moscowNowParts();
  const nowMin = hour * 60 + minute;
  const slots = [];
  for (
    let total = nowMin - stepMinutes;
    total >= startHour * 60 && slots.length < count;
    total -= stepMinutes
  ) {
    slots.unshift({
      hour: Math.floor(total / 60),
      minute: total % 60,
    });
  }
  return slots;
}

const TODAY = moscowDate(0);
const TOMORROW = moscowDate(1);
const DAY_AFTER = moscowDate(2);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query('BEGIN');

  const siteRes = await client.query(
    `SELECT id, code FROM site WHERE active = true ORDER BY code LIMIT 1`,
  );
  if (!siteRes.rows[0]) {
    throw new Error('Нет активной площадки — сначала npm run reset:data');
  }
  const siteId = siteRes.rows[0].id;
  const siteCode = siteRes.rows[0].code;

  const serviceRes = await client.query(
    `SELECT id FROM service_type WHERE active = true AND "siteId" = $1 ORDER BY name LIMIT 1`,
    [siteId],
  );
  if (!serviceRes.rows[0]) {
    throw new Error('Нет услуг на площадке');
  }
  const serviceId = serviceRes.rows[0].id;

  const desksRes = await client.query(
    `SELECT id, label, country, "displayNumber" FROM desk WHERE active = true AND "siteId" = $1 ORDER BY label`,
    [siteId],
  );
  const rfDesks = desksRes.rows.filter((row) => row.country === 'RF');
  const cnDesk = desksRes.rows.find((row) => row.country === 'CN');
  if (!rfDesks.length || !cnDesk) {
    throw new Error('Нужны столы РФ и Заграничная');
  }

  await client.query('DELETE FROM assignment');
  await client.query('DELETE FROM ticket_event');
  await client.query('DELETE FROM ticket');

  try {
    const Redis = (await import('ioredis')).default;
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:56379';
    const redis = new Redis(redisUrl);
    await redis.flushdb();
    await redis.quit();
  } catch (error) {
    console.warn('Redis flush skipped:', error.message);
  }

  async function ensureEmployeeRecord(
    oidcSubject,
    displayName,
    country,
    deskId,
    status,
  ) {
    const existing = await client.query(
      `SELECT id FROM employee WHERE "oidcSubject" = $1`,
      [oidcSubject],
    );
    if (existing.rows[0]) {
      await client.query(
        `UPDATE employee
            SET "displayName" = $2, status = $3, "siteId" = $4, "deskId" = $5,
                country = $6, "updatedAt" = now()
          WHERE id = $1`,
        [existing.rows[0].id, displayName, status, siteId, deskId, country],
      );
      return existing.rows[0].id;
    }
    const inserted = await client.query(
      `INSERT INTO employee (
         id, "oidcSubject", "displayName", role, status, "siteId", "deskId", country, "updatedAt"
       )
       VALUES (gen_random_uuid(), $1, $2, 'EMPLOYEE', $3, $4, $5, $6, now())
       RETURNING id`,
      [oidcSubject, displayName, status, siteId, deskId, country],
    );
    return inserted.rows[0].id;
  }

  async function syncKeycloakStaff() {
    const rows = [
      {
        username: 'rf1',
        displayName: 'Иван РФ-1',
        country: 'RF',
        desk: rfDesks[0],
        status: 'BUSY',
      },
      {
        username: 'rf2',
        displayName: 'Пётр РФ-2',
        country: 'RF',
        desk: rfDesks[1] ?? rfDesks[0],
        status: 'AVAILABLE',
      },
      {
        username: 'cn1',
        displayName: 'Ли Заграничная',
        country: 'CN',
        desk: cnDesk,
        status: 'AVAILABLE',
      },
    ];
    for (const row of rows) {
      const users = kcadmJson(
        `get users -r ticket-system -q username=${row.username} --fields id,username`,
      );
      const subject = Array.isArray(users) ? users[0]?.id : null;
      if (!subject) continue;
      await ensureEmployeeRecord(
        subject,
        row.displayName,
        row.country,
        row.desk.id,
        row.status,
      );
    }
  }

  await syncKeycloakStaff();

  const employeeRf1 = await ensureEmployeeRecord(
    'seed-demo-rf1',
    'Смирнова Елена',
    'RF',
    rfDesks[0].id,
    'BUSY',
  );
  const employeeRf2 = await ensureEmployeeRecord(
    'seed-demo-rf2',
    'Козлов Артём',
    'RF',
    rfDesks[1]?.id ?? rfDesks[0].id,
    'AVAILABLE',
  );
  const employeeCn = await ensureEmployeeRecord(
    'seed-demo-cn1',
    'Ли Мин',
    'CN',
    cnDesk.id,
    'AVAILABLE',
  );
  const employeeRf3 = await ensureEmployeeRecord(
    'seed-demo-rf3',
    'Павлова Ирина',
    'RF',
    rfDesks[1]?.id ?? rfDesks[0].id,
    'AVAILABLE',
  );

  await client.query(`
    DELETE FROM assignment
     WHERE "employeeId" IN (
       SELECT id FROM employee WHERE "oidcSubject" LIKE 'seed-demo-%'
     )
  `);

  let seq = 0;

  async function insertBooking({
    fullName,
    country,
    date,
    hour,
    minute,
    duration,
    deskId,
    status,
    departureDate,
    arrivalDate,
    priority = 0,
  }) {
    seq += 1;
    const number = `DEMO-${String(seq).padStart(3, '0')}`;
    const scheduledAt = slotIso(date, hour, minute);
    const checkedIn =
      status !== 'BOOKED' && status !== 'NO_SHOW' && status !== 'CANCELLED';
    const inserted = await client.query(
      `INSERT INTO ticket (
         id, number, "accessTokenHash", "lookupCodeHash", status, "callAttempts", priority,
         "siteId", "serviceTypeId", country, "fullName", "departureDate", "arrivalDate",
         "personalDataConsentAt", "scheduledAt", "checkedInAt", "durationMinutes", "reservedDeskId",
         "createdAt", "updatedAt"
       )
       VALUES (
         gen_random_uuid(), $1, $2, $3, $4, 0, $5,
         $6, $7, $8, $9, $10, $11,
         now(), $12::timestamptz, CASE WHEN $13 THEN now() ELSE NULL END, $14, $15,
         now(), now()
       )
       RETURNING id`,
      [
        number,
        hashToken(randomUUID()),
        hashToken(lookupCode()),
        status,
        priority || (checkedIn ? 1 : 0),
        siteId,
        serviceId,
        country,
        fullName,
        departureDate,
        arrivalDate,
        scheduledAt,
        checkedIn,
        duration,
        deskId,
      ],
    );
    return { id: inserted.rows[0].id, number, scheduledAt };
  }

  async function insertTodayLive({
    fullName,
    country,
    hour,
    minute,
    status,
    duration,
    deskId,
    priority = 1,
  }) {
    return insertBooking({
      fullName,
      country,
      date: TODAY,
      hour,
      minute,
      duration,
      deskId,
      status,
      departureDate: TODAY,
      arrivalDate: TOMORROW,
      priority,
    });
  }

  async function insertAssignment(ticketId, employeeId, deskId, flags = {}) {
    await client.query(
      `INSERT INTO assignment (
         id, "ticketId", "employeeId", "deskId", active,
         "assignedAt", "calledAt", "startedAt", "completedAt"
       )
       VALUES (
         gen_random_uuid(), $1, $2, $3, true,
         now(), $4, $5, NULL
       )`,
      [
        ticketId,
        employeeId,
        deskId,
        flags.called ? new Date() : null,
        flags.started ? new Date() : null,
      ],
    );
  }

  const upcoming = nextSlotTimes(6, 8, 20);
  const past = pastSlotTimes(3, 8, 20);

  const bookingRows = [
    {
      fullName: 'Иванов Иван Иванович',
      ...upcoming[0],
      status: 'BOOKED',
      desk: rfDesks[0],
    },
    {
      fullName: 'Петрова Анна Сергеевна',
      ...upcoming[1],
      status: 'BOOKED',
      desk: rfDesks[0],
    },
    {
      fullName: 'Сидоров Пётр Алексеевич',
      ...upcoming[2],
      status: 'CHECKED_IN',
      desk: rfDesks[0],
    },
    {
      fullName: 'Кузнецова Мария Олеговна',
      ...upcoming[3],
      status: 'ASSIGNED',
      desk: rfDesks[1] ?? rfDesks[0],
    },
    {
      fullName: 'Морозов Андрей Николаевич',
      ...(past[0] ?? upcoming[0]),
      status: 'COMPLETED',
      desk: rfDesks[0],
    },
    {
      fullName: 'Новикова Ольга Викторовна',
      ...(past[1] ?? past[0] ?? upcoming[0]),
      status: 'COMPLETED',
      desk: rfDesks[0],
    },
    {
      fullName: 'Волков Дмитрий Игоревич',
      ...(past[2] ?? past[0] ?? upcoming[0]),
      status: 'NO_SHOW',
      desk: rfDesks[1] ?? rfDesks[0],
    },
    {
      fullName: 'Ли Вэй',
      ...upcoming[0],
      status: 'BOOKED',
      desk: cnDesk,
      country: 'CN',
      duration: 30,
    },
    {
      fullName: 'Чжан Мин',
      ...upcoming[1],
      status: 'CHECKED_IN',
      desk: cnDesk,
      country: 'CN',
      duration: 30,
    },
  ];

  for (const row of bookingRows) {
    const country = row.country ?? 'RF';
    const duration = row.duration ?? 20;
    const desk = row.desk;
    const saved = await insertBooking({
      fullName: row.fullName,
      country,
      date: TODAY,
      hour: row.hour,
      minute: row.minute,
      duration,
      deskId: desk.id,
      status: row.status,
      departureDate: TODAY,
      arrivalDate: TOMORROW,
    });
  }

  const liveToday = [
    { fullName: 'Романов Сергей Владимирович', status: 'CHECKED_IN', ...upcoming[4] },
    { fullName: 'Егорова Наталья Петровна', status: 'REQUEUED', ...upcoming[5] },
    {
      fullName: 'Фёдоров Глеб Александрович',
      status: 'CALLED',
      desk: rfDesks[1] ?? rfDesks[0],
      ...(past[1] ?? past[0] ?? upcoming[0]),
    },
    {
      fullName: 'Михайлова Юлия Игоревна',
      status: 'IN_SERVICE',
      desk: rfDesks[0],
      ...(past[0] ?? upcoming[0]),
    },
  ];

  for (const row of liveToday) {
    const desk = row.desk ?? rfDesks[1] ?? rfDesks[0];
    const slot =
      row.hour != null
        ? { hour: row.hour, minute: row.minute }
        : past[0] ?? upcoming[0];
    const saved = await insertTodayLive({
      fullName: row.fullName,
      country: 'RF',
      hour: slot.hour,
      minute: slot.minute,
      status: row.status,
      duration: 20,
      deskId: desk.id,
    });
    if (row.status === 'CALLED') {
      await insertAssignment(saved.id, employeeRf3, desk.id, { called: true });
    }
    if (row.status === 'IN_SERVICE') {
      await insertAssignment(saved.id, employeeRf1, desk.id, {
        started: true,
      });
    }
  }

  const tomorrowSlots = nextSlotTimes(4, 8, 20);
  for (const [index, row] of [
    { fullName: 'Орлов Кирилл Денисович', country: 'RF' },
    { fullName: 'Белова Татьяна Юрьевна', country: 'RF' },
    { fullName: 'Федоров Илья Максимович', country: 'RF' },
    { fullName: 'Чжоу Лин', country: 'CN', duration: 30, desk: cnDesk },
  ].entries()) {
    const country = row.country ?? 'RF';
    const duration = row.duration ?? 20;
    const desk = row.desk ?? rfDesks[index % rfDesks.length];
    await insertBooking({
      fullName: row.fullName,
      country,
      date: TOMORROW,
      hour: tomorrowSlots[index].hour,
      minute: tomorrowSlots[index].minute,
      duration,
      deskId: desk.id,
      status: 'BOOKED',
      departureDate: TODAY,
      arrivalDate: DAY_AFTER,
    });
  }

  const dayAfterSlots = nextSlotTimes(4, 9, 20);
  for (const [index, row] of [
    { fullName: 'Громов Павел Сергеевич', country: 'RF' },
    { fullName: 'Соколова Екaterina Андреевна', country: 'RF' },
    { fullName: 'Титов Максим Олегович', country: 'RF' },
    { fullName: 'Huang Wei', country: 'CN', duration: 30, desk: cnDesk },
  ].entries()) {
    const country = row.country ?? 'RF';
    const duration = row.duration ?? 20;
    const desk = row.desk ?? rfDesks[index % rfDesks.length];
    await insertBooking({
      fullName: row.fullName,
      country,
      date: DAY_AFTER,
      hour: dayAfterSlots[index].hour,
      minute: dayAfterSlots[index].minute,
      duration,
      deskId: desk.id,
      status: 'BOOKED',
      departureDate: TOMORROW,
      arrivalDate: moscowDate(3),
    });
  }

  await client.query('COMMIT');

  const stats = await client.query(
    `SELECT
       COUNT(*)::int AS demo_total,
       COUNT(*) FILTER (
         WHERE "scheduledAt" >= $1::timestamptz AND "scheduledAt" < $2::timestamptz
       )::int AS slots_today,
       COUNT(*) FILTER (
         WHERE "scheduledAt" >= $2::timestamptz AND "scheduledAt" < $3::timestamptz
       )::int AS slots_tomorrow,
       COUNT(*) FILTER (
         WHERE "scheduledAt" >= $3::timestamptz AND "scheduledAt" < $4::timestamptz
       )::int AS slots_day_after,
       COUNT(*) FILTER (
         WHERE status IN ('BOOKED','WAITING','CHECKED_IN','REQUEUED','ASSIGNED','CALLED','IN_SERVICE')
       )::int AS board_live
     FROM ticket`,
    [
      `${TODAY}T00:00:00+03:00`,
      `${TOMORROW}T00:00:00+03:00`,
      `${DAY_AFTER}T00:00:00+03:00`,
      `${moscowDate(3)}T00:00:00+03:00`,
    ],
  );

  console.log(`Демо (${siteCode}) — сегодня ${TODAY}, завтра ${TOMORROW}, послезавтра ${DAY_AFTER}:`, stats.rows[0]);
  console.log('Запись: http://localhost:18080/client/');
  console.log('Табло: http://localhost:18080/client/board?country=RF');
  console.log(`Менеджер: http://localhost:18080/staff/ — даты ${TODAY} / ${TOMORROW} / ${DAY_AFTER}`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}

console.log('SEED_DEMO_OK');
