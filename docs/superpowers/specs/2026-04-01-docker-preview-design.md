# Docker Preview Launch — Design Spec

## Проблема

Веб-проекты, созданные пайплайном, невозможно быстро посмотреть в браузере. QA и DevOps запускают проекты вручную. Нужна кнопка запуска preview прямо из дашборда.

## Решение

Кнопка "Запустить preview" на странице проекта. Видна только для веб-проектов (определяется по `package.json` в `project_path`). Запускает агента, который проверяет/генерирует Docker-конфигурацию, поднимает контейнеры, проверяет здоровье и отдаёт URL.

## Определение веб-проекта

Сканируем `package.json` в `project_path` на наличие зависимостей: express, next, react, vue, nuxt, vite, fastify, @nestjs/core, hono. Результат кешируется в `state.is_web_project: boolean`.

## State

```typescript
preview?: {
  status: "starting" | "running" | "failed" | "stopped";
  url?: string;              // http://localhost:37482
  ports?: { app: number; db?: number };
  compose_file?: string;     // путь к docker-compose.preview.yml
  started_at?: string;
  error?: string;
  logs?: string;             // последние логи при ошибке
}
```

## API

### POST /api/state/[id]/preview

Body: `{ action: "start" | "stop" }`

- `start`: запускает агента в фоне, сразу возвращает `{ status: "starting" }`. Агент обновляет state по завершении.
- `stop`: выполняет `docker compose -f docker-compose.preview.yml down`, обновляет state на `stopped`.

### Определение веб-проекта

При загрузке state (`getProjectState`) проверяем `project_path/package.json` и устанавливаем `is_web_project`.

## Агент

Модель: claude-sonnet-4-6. Промпт с чёткими шагами:

1. Проверить наличие `docker-compose.preview.yml` или `docker-compose.yml` в `project_path`
2. Если есть — использовать (подменив порты на свободные)
3. Если нет — прочитать `package.json`, определить стек, сгенерировать `Dockerfile` + `docker-compose.preview.yml`
4. Найти свободные порты: случайный из 10000-60000, проверить `lsof -i :PORT`
5. Запустить `docker compose -f docker-compose.preview.yml up -d --build`
6. Подождать 15 сек, проверить `docker compose ps` — контейнеры running
7. Проверить `docker compose logs --tail=50` — нет fatal/panic
8. Проверить `curl -s -o /dev/null -w "%{http_code}" http://localhost:PORT`
9. Вернуть JSON с результатом

Отдельный файл `docker-compose.preview.yml` — не конфликтует с основным docker-compose.yml от devops-агента.

## Порты

- Диапазон: 10000-60000
- Выбор: случайный, проверка через `lsof -i :PORT`
- Если занят — следующий случайный (до 10 попыток)

## UI

На странице проекта `/project/[id]`:

- **Кнопка "Запустить preview"** — зелёная, видна только если `is_web_project && preview?.status !== "running" && preview?.status !== "starting"`
- **"Запускается..."** — спиннер при `status === "starting"`
- **"Preview запущен"** — кликабельная ссылка на URL + кнопка "Остановить" при `status === "running"`
- **Ошибка** — логи + кнопка "Повторить" при `status === "failed"`
