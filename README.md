# Электронная очередь

MVP для одной площадки: клиент записывается по QR-ссылке, указывает ФИО и
сведения о поездках и даёт согласие на обработку ПДн. Авторизованный
сотрудник получает следующий совместимый талон. Администратор и аудитор
используют закрытый интерфейс с разными правами.

## Состав

- `apps/client-web` — публичный React-интерфейс клиента;
- `apps/staff-web` — React-интерфейс сотрудника и администратора;
- `apps/api` — NestJS API, OIDC BFF, очередь, аудит и метрики;
- `packages/contracts` — общие типы контрактов;
- `infra` — PostgreSQL, Redis и локальный Keycloak;
- `docs` — архитектурные, эксплуатационные и регуляторные материалы.

PostgreSQL является источником истины. Назначение выполняется внутри транзакции
с `FOR UPDATE SKIP LOCKED` и частичными уникальными индексами, поэтому один
талон или сотрудник не могут иметь два активных назначения.

## Локальный запуск

### Полностью в Docker

```text
docker compose -f infra/docker-compose.yml up --build -d
```

После запуска:

- клиент: `http://localhost:18080/client/`;
- сотрудник/администратор: `http://localhost:18080/staff/`;
- OpenAPI: `http://localhost:18080/api/docs`;
- Keycloak: `http://localhost:18080/admin/`.

Остановить стек: `docker compose -f infra/docker-compose.yml down`.
Данные PostgreSQL и Redis сохраняются в Docker volumes. Для полного удаления
локальных данных добавьте `-v` к команде `down`.

**Доступ по IP (не localhost):** задайте публичные URL до запуска compose.
Сервис `keycloak-config` автоматически регистрирует callback, web origin и
post-logout URL после готовности Keycloak. Данные Keycloak сохраняются в
volume `keycloak-data`.

В `.env` задайте (порт 18080 обязателен):

```text
PUBLIC_ORIGIN=http://94.231.221.214:18080
OIDC_ISSUER=http://94.231.221.214:18080/realms/ticket-system
OIDC_CALLBACK_URL=http://94.231.221.214:18080/api/auth/callback
STAFF_APP_URL=http://94.231.221.214:18080/staff/
CLIENT_ORIGIN=http://94.231.221.214:18080
STAFF_ORIGIN=http://94.231.221.214:18080
```

Запускайте compose из корня с явным `.env`:

```text
docker compose --env-file .env -f infra/docker-compose.yml up --build -d --wait
docker compose --env-file .env -f infra/docker-compose.yml logs keycloak-config
```

В логе должна быть строка `Keycloak: redirect http://<IP>:18080/api/auth/callback`.

### Запуск приложений через npm

1. Скопировать `.env.example` в `.env` и заменить секреты.
2. Запустить инфраструктуру:
   `docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up -d postgres redis keycloak`.
3. Запустить в отдельных терминалах:
   `npm run dev:api`, `npm run dev:client`, `npm run dev:staff`.
4. Клиент: `http://localhost:5173`; сотрудник: `http://localhost:5174`;
   OpenAPI: `http://localhost:3000/api/docs`.

Для печатного QR используйте URL вида
`https://queue.example.ru/client?site=MAIN`; параметр только сверяет код
площадки и не создаёт walk-in талон. QR генерируется утверждённым
офлайн-инструментом и не содержит секретов или персональных данных.

Тестовые учётные записи (только локальный запуск, в production не импортируются):

- администратор: `admin` / `Admin123!`;
- сотрудник: `rf1` / `Employee123!`;
- аудитор: `auditor` / `Auditor123!`.

## Production

Минимум **2 ГБ RAM**, порты `80` (редирект на HTTPS) и `443`. Запуск только из
корня репозитория, без `--project-directory`.

```text
git clone https://github.com/Alvik403/ticket_system.git
cd ticket_system
cp .env.example .env
# заполнить POSTGRES_PASSWORD, REDIS_PASSWORD, SESSION_SECRET,
# OIDC_CLIENT_SECRET, KC_BOOTSTRAP_ADMIN_PASSWORD
# опционально STAFF_ADMIN_USERNAME и STAFF_ADMIN_PASSWORD — первый ADMIN
# PUBLIC_ORIGIN не обязателен: скрипт сам подставит https://<публичный-IP>
chmod +x infra/prod-up.sh
sudo bash infra/prod-up.sh
```

- `infra/docker-compose.prod.yml`: БД/Redis не публикуются, OpenAPI выключен.
- API и Keycloak используют PostgreSQL; Keycloak хранит таблицы в отдельной
  схеме `keycloak`, поэтому созданные сотрудники переживают пересоздание контейнера.
- Схема API создаётся и обновляется версионированными миграциями;
  `DB_SYNCHRONIZE=false`.
- `COOKIE_SECURE=true`, CORS и OIDC callback берутся из `PUBLIC_ORIGIN`.
- HTTP `:80` только редиректит на HTTPS; приложение слушает `:443`.
  Если сертификатов нет, `prod-up.sh` выпускает самоподписанный на IP сервера.
  Для домена задайте `PUBLIC_ORIGIN=https://ваш.домен` и положите доверенные
  файлы в `infra/certs/`.
- Демо-учётки Keycloak в production не импортируются; `redirectUris` и `webOrigins` без `*`.
- Пароли без пробелов, `$` и `#`.
- `prod-up.sh` собирает образы последовательно, чтобы не исчерпать 2 ГБ RAM.
- Первый build Keycloak выполняет оптимизацию Quarkus; последующие старты
  используют `start --optimized`. Публичный клиент и API не ждут готовности OIDC.
- Включить TOTP для администраторов, WAF, мониторинг и backup. Организационные
  действия: `docs/security-and-personal-data.md`.

## Проверки

```text
npm run build
npm run lint
npm test
```

