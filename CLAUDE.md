# Product Development Pipeline

Полный цикл создания продукта: от идеи до прода и обратно.

## Структура

- `agents/` — 21 агент (19 специализированных + 2 мета), каждый с system-prompt.md, rules.md, skills/
- `orchestrator/` — Python: DAG executor, state machine, pipeline builder
- `dashboard/` — Next.js: визуализация графа пайплайна, управление gate-точками
- `projects/` — артефакты проектов (gitignored, runtime данные)
- `docs/` — спецификации и документация

## Режимы работы

- `auto` — полная автоматизация, остановки только на gate-точках
- `human_approval` — подтверждение после каждого агента

## Human Gates

1. **Gate 1 (Строим?)** — после PO, перед Pipeline Architect. Решения: go / pivot / stop
2. **Gate 2 (Архитектура)** — после System Architect + UX/UI Designer, перед Tech Lead. Решения: go / revise / stop
3. **Gate 3 (Go/No-go)** — после QA + Security + DevOps, перед Release Manager. Решения: go / no-go / rollback

## Агенты

Агенты запускаются как Claude Code субагенты (Agent tool). Промпт загружается из `system-prompt.md`, правила из `rules.md`. Артефакты сохраняются в `projects/{project_id}/{phase}/{agent-name}/`.

### Фазы

| Фаза | Агенты |
|------|--------|
| Мета | Pipeline Architect, Orchestrator |
| Исследование | Problem Researcher, Market Researcher |
| Продукт | Product Owner, Business Analyst |
| Юридическое | Legal / Compliance |
| Дизайн | UX/UI Designer |
| Разработка | System Architect, Tech Lead, Backend Developer, Frontend Developer, DevOps Engineer |
| Качество | QA Engineer, Security Engineer |
| Релиз | Release Manager |
| Маркетинг | Product Marketer, SMM Manager, Content Creator |
| Фидбек | Customer Support, Data Analyst |

## Оркестратор

Главный процесс: `orchestrator/engine.py`

- Читает state из `orchestrator/state/{project_id}.json`
- Находит агентов с выполненными зависимостями
- Запускает их параллельно
- На gate-точках — пауза, ждёт решение через дашборд или CLI
- При ошибке: 1 retry, затем fail

## Дашборд

Next.js приложение: `dashboard/`

- `/` — список проектов
- `/project/[id]` — граф пайплайна + gate controls
- `/project/[id]/agent/[name]` — детали агента

API routes:
- `GET /api/state/[id]` — чтение state
- `POST /api/state/[id]/gate` — запись gate-решения
- `POST /api/projects` — создание проекта

## Создание проекта

Все проекты сохраняются в папке `projects/` (gitignored). Дизайны хранятся рядом с проектом.

## Язык

- Оркестратор: Python 3.10+
- Дашборд: TypeScript (Next.js 15)
- Промпты: Markdown (русский язык)
