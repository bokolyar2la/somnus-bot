# Somnus (AI Dream Journal Bot)

Телеграм-бот для ведения дневника снов, интерпретаций и отчётов.

## Локальный запуск

### 1) Подготовка

- Node.js v20+
- Создай `.env` (см. `.env.example`) и **впиши сюда реальные токены**:
  - `BOT_TOKEN` — токен бота от BotFather
  - `OPENAI_API_KEY` — ключ OpenAI
  - `ADMIN_IDS` — твой TG id (числом), опционально несколько через запятую
  - `DATABASE_URL=file:./prisma/dev.db`

### 2) Установка и генерация Prisma клиента

```bash
npm install
npm run prisma:generate
```

Dev-режим (long polling)
npm run dev

Напиши боту в Telegram: /start.

Сборка и запуск прод-режима
npm run build
npm start

Полезные скрипты

npm run prisma:generate — Prisma Client

npm run prisma:migrate — миграции

npm run prisma:studio — GUI для базы

npm run test:smoke — простой дымовой тест

Безопасность

.env и файлы базы (prisma/\*.db) не коммитим.

Никогда не публикуй реальные токены в репозитории/issue.

Стек

Telegram (grammY), TypeScript

Prisma + SQLite (dev)

OpenAI API

Pino, Prometheus metrics
