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

Тестовые учётные записи:

- администратор: `admin` / `Admin123!`;
- сотрудник: `rf1` / `Employee123!`;
- аудитор: `auditor` / `Auditor123!`.

Они предназначены только для локальной проверки и должны быть удалены или
заменены перед пилотной и промышленной эксплуатацией.

## Production

- Использовать `infra/docker-compose.prod.yml`: без publish портов БД/Redis,
  без Keycloak `/admin/` и OpenAPI, `DB_SYNCHRONIZE=false`, `COOKIE_SECURE=true`.
- Задать `SESSION_SECRET`, `OIDC_CLIENT_SECRET`, `POSTGRES_PASSWORD`,
  `REDIS_PASSWORD`, `KC_BOOTSTRAP_ADMIN_PASSWORD` без значений по умолчанию.
- Применять миграции (`npm run migration:run --workspace api` после `build`).
- Размещать приложение, OIDC, БД, журналы и резервные копии в РФ.
- Использовать управляемые PostgreSQL/Redis/KMS, private network и TLS.
- Заменить все демонстрационные секреты, включить TOTP для администраторов,
  WAF/rate limiting, централизованный аудит, мониторинг и проверенное
  восстановление из backup.
- Завершить организационные действия из `docs/security-and-personal-data.md`.

## Проверки

```text
npm run build
npm run lint
npm test
```

