import pg from 'pg';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://ticket:ticket@localhost:55432/ticket';

const hashToken = (value) => createHash('sha256').update(value).digest('hex');

const lookupCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[randomBytes(1)[0] % alphabet.length]).join('');
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

function slotIso(date, hours, minutes) {
  return `${date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+03:00`;
}

const TODAY = moscowDate(0);
const TOMORROW = moscowDate(1);
const YESTERDAY = moscowDate(-1);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query('BEGIN');

  const siteRes = await client.query(
    `SELECT id, code FROM site WHERE active = true ORDER BY code LIMIT 1`,
  );
  if (!siteRes.rows[0]) {
    throw new Error('Нет активной площадки — сначала запустите API или npm run reset:data');
  }
  const siteId = siteRes.rows[0].id;
  const siteCode = siteRes.rows[0].code;

  const serviceRes = await client.query(
    `SELECT id FROM service_type WHERE active = true AND "siteId" = $1 ORDER BY name LIMIT 1`,
    [siteId],
  );
  if (!serviceRes.rows[0]) {
    throw new Error('Нет услуг — сначала запустите API');
  }
  const serviceId = serviceRes.rows[0].id;

  const desksRes = await client.query(
    `SELECT id, label, country FROM desk WHERE active = true AND "siteId" = $1 ORDER BY label`,
    [siteId],
  );
  const rfDesks = desksRes.rows.filter((row) => row.country === 'RF');
  const cnDesks = desksRes.rows.filter((row) => row.country === 'CN');
  if (!rfDesks.length || !cnDesks.length) {
    throw new Error('Нужны столы РФ и Китай');
  }

  await client.query(`
    DELETE FROM assignment
     WHERE "ticketId"::text IN (SELECT id::text FROM ticket WHERE number LIKE 'DEMO-%')
  `);
  await client.query(`
    DELETE FROM ticket_event
     WHERE "ticketId"::text IN (SELECT id::text FROM ticket WHERE number LIKE 'DEMO-%')
  `);
  await client.query(`DELETE FROM ticket WHERE number LIKE 'DEMO-%'`);

  let seq = 0;
  const insertTicket = async ({
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
  }) => {
    seq += 1;
    const number = `DEMO-${String(seq).padStart(3, '0')}`;
    const scheduledAt = slotIso(date, hour, minute);
    const token = randomUUID();
    const code = lookupCode();
    await client.query(
      `INSERT INTO ticket (
         id, number, "accessTokenHash", "lookupCodeHash", status, "callAttempts", priority,
         "siteId", "serviceTypeId", country, "fullName", "departureDate", "arrivalDate",
         "personalDataConsentAt", "scheduledAt", "durationMinutes", "reservedDeskId"
       )
       VALUES (
         gen_random_uuid(), $1, $2, $3, $4, 0, $5,
         $6, $7, $8, $9, $10, $11,
         now(), $12::timestamptz, $13, $14
       )`,
      [
        number,
        hashToken(token),
        hashToken(code),
        status,
        status === 'CHECKED_IN' || status === 'IN_SERVICE' ? 1 : 0,
        siteId,
        serviceId,
        country,
        fullName,
        departureDate,
        arrivalDate,
        scheduledAt,
        duration,
        deskId,
      ],
    );
  };

  const rfRows = [
    { fullName: 'Иванов Иван Иванович', hour: 8, minute: 0, status: 'BOOKED', desk: rfDesks[0] },
    { fullName: 'Петрова Анна Сергеевна', hour: 8, minute: 20, status: 'CHECKED_IN', desk: rfDesks[0] },
    { fullName: 'Сидоров Пётр Алексеевич', hour: 8, minute: 40, status: 'IN_SERVICE', desk: rfDesks[0] },
    { fullName: 'Кузнецова Мария Олеговна', hour: 9, minute: 0, status: 'COMPLETED', desk: rfDesks[0] },
    { fullName: 'Волков Дмитрий Игоревич', hour: 9, minute: 20, status: 'NO_SHOW', desk: rfDesks[1] ?? rfDesks[0] },
    { fullName: 'Соколова Елена Павловна', hour: 9, minute: 40, status: 'CANCELLED', desk: rfDesks[1] ?? rfDesks[0] },
    { fullName: 'Морозов Андрей Николаевич', hour: 10, minute: 0, status: 'BOOKED', desk: rfDesks[1] ?? rfDesks[0] },
    { fullName: 'Новикова Ольга Викторовна', hour: 10, minute: 20, status: 'BOOKED', desk: rfDesks[0] },
  ];

  for (const row of rfRows) {
    await insertTicket({
      ...row,
      country: 'RF',
      date: TODAY,
      duration: 20,
      deskId: row.desk.id,
      departureDate: YESTERDAY,
      arrivalDate: TODAY,
    });
  }

  const cnRows = [
    { fullName: 'Ли Вэй', hour: 8, minute: 0, status: 'BOOKED' },
    { fullName: 'Ван Фан', hour: 8, minute: 30, status: 'CHECKED_IN' },
    { fullName: 'Чжан Мин', hour: 9, minute: 0, status: 'BOOKED' },
    { fullName: 'Чэнь Юй', hour: 9, minute: 30, status: 'COMPLETED' },
    { fullName: 'Лю На', hour: 10, minute: 0, status: 'IN_SERVICE' },
  ];

  for (const row of cnRows) {
    await insertTicket({
      ...row,
      country: 'CN',
      date: TODAY,
      duration: 30,
      deskId: cnDesks[0].id,
      departureDate: moscowDate(-3),
      arrivalDate: TOMORROW,
    });
  }

  const tomorrowRf = [
    { fullName: 'Орлов Кирилл Денисович', hour: 8, minute: 0 },
    { fullName: 'Белова Татьяна Юрьевна', hour: 8, minute: 20 },
    { fullName: 'Федоров Илья Максимович', hour: 8, minute: 40 },
  ];
  for (const [index, row] of tomorrowRf.entries()) {
    await insertTicket({
      ...row,
      country: 'RF',
      date: TOMORROW,
      duration: 20,
      deskId: rfDesks[index % rfDesks.length].id,
      status: 'BOOKED',
      departureDate: TODAY,
      arrivalDate: moscowDate(4),
    });
  }

  await insertTicket({
    fullName: 'Хуан Чжи',
    country: 'CN',
    date: TOMORROW,
    hour: 8,
    minute: 0,
    duration: 30,
    deskId: cnDesks[0].id,
    status: 'BOOKED',
    departureDate: TODAY,
    arrivalDate: moscowDate(5),
  });

  await client.query('COMMIT');

  const stats = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE number LIKE 'DEMO-%')::int AS demo_tickets,
       COUNT(*) FILTER (WHERE number LIKE 'DEMO-%' AND "scheduledAt"::date = $1::date)::int AS today
     FROM ticket`,
    [TODAY],
  );
  console.log(`Demo data seeded (${siteCode}):`, stats.rows[0]);
  console.log(`Сегодня ${TODAY}: записи DEMO-* видны менеджеру в «Записи на день».`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}

console.log('SEED_DEMO_OK');
