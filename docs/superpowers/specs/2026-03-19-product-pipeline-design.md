# Product Development Pipeline — Design Spec

## Overview

Полный цикл создания продукта: от идеи до прода и обратно. Пайплайн из 19 специализированных агентов и 2 мета-агентов (21 всего), организованных в DAG с параллельными ветками и точками сведения. Три human gate точки обеспечивают человеческий контроль на ключевых решениях.

## Архитектура

**Подход A: Монорепо с shared state.**

- `orchestrator/` — Python: DAG executor, state machine, pipeline builder
- `agents/` — 21 агент (19 специализированных + 2 мета), каждый с system-prompt.md, rules.md, skills/
- `dashboard/` — Next.js: визуализация графа пайплайна, управление gate-точками
- `projects/` — артефакты проектов (gitignored, runtime)

Агенты запускаются как Claude Code субагенты (Agent tool). Оркестратор — главный Python-процесс.

## Структура файлов

```
Product Development Pipeline/
├── orchestrator/
│   ├── engine.py                    # DAG executor, state machine loop
│   ├── config.py                    # Конфигурация, пути, константы
│   ├── gates.py                     # Human gate логика (3 точки)
│   ├── pipeline_builder.py          # Pipeline Architect: сборка графа по брифу
│   ├── agent_runner.py              # Запуск агентов через Claude Code
│   ├── requirements.txt
│   └── state/                       # JSON state per project (runtime, gitignored)
│
├── agents/
│   ├── meta/
│   │   ├── pipeline-architect/
│   │   │   ├── system-prompt.md
│   │   │   ├── rules.md
│   │   │   └── skills/
│   │   └── orchestrator/
│   │       ├── system-prompt.md
│   │       ├── rules.md
│   │       └── skills/
│   ├── research/
│   │   ├── problem-researcher/
│   │   │   ├── system-prompt.md
│   │   │   ├── rules.md
│   │   │   └── skills/
│   │   └── market-researcher/
│   │       ├── system-prompt.md
│   │       ├── rules.md
│   │       └── skills/
│   ├── product/
│   │   ├── product-owner/
│   │   │   ├── system-prompt.md
│   │   │   ├── rules.md
│   │   │   └── skills/
│   │   └── business-analyst/
│   │       ├── system-prompt.md
│   │       ├── rules.md
│   │       └── skills/
│   ├── legal/
│   │   └── legal-compliance/
│   │       ├── system-prompt.md
│   │       ├── rules.md
│   │       └── skills/
│   ├── design/
│   │   └── ux-ui-designer/
│   │       ├── system-prompt.md
│   │       ├── rules.md
│   │       └── skills/
│   ├── development/
│   │   ├── system-architect/
│   │   │   ├── system-prompt.md
│   │   │   ├── rules.md
│   │   │   └── skills/
│   │   ├── tech-lead/
│   │   │   ├── system-prompt.md
│   │   │   ├── rules.md
│   │   │   └── skills/
│   │   ├── backend-developer/
│   │   │   ├── system-prompt.md
│   │   │   ├── rules.md
│   │   │   └── skills/
│   │   ├── frontend-developer/
│   │   │   ├── system-prompt.md
│   │   │   ├── rules.md
│   │   │   └── skills/
│   │   └── devops-engineer/
│   │       ├── system-prompt.md
│   │       ├── rules.md
│   │       └── skills/
│   ├── quality/
│   │   ├── qa-engineer/
│   │   │   ├── system-prompt.md
│   │   │   ├── rules.md
│   │   │   └── skills/
│   │   └── security-engineer/
│   │       ├── system-prompt.md
│   │       ├── rules.md
│   │       └── skills/
│   ├── release/
│   │   └── release-manager/
│   │       ├── system-prompt.md
│   │       ├── rules.md
│   │       └── skills/
│   ├── marketing/
│   │   ├── product-marketer/
│   │   │   ├── system-prompt.md
│   │   │   ├── rules.md
│   │   │   └── skills/
│   │   ├── smm-manager/
│   │   │   ├── system-prompt.md
│   │   │   ├── rules.md
│   │   │   └── skills/
│   │   └── content-creator/
│   │       ├── system-prompt.md
│   │       ├── rules.md
│   │       └── skills/
│   └── feedback/
│       ├── customer-support/
│       │   ├── system-prompt.md
│       │   ├── rules.md
│       │   └── skills/
│       └── data-analyst/
│           ├── system-prompt.md
│           ├── rules.md
│           └── skills/
│
├── dashboard/
│   ├── package.json
│   ├── next.config.js
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx                      # Список проектов
│   │   │   └── project/
│   │   │       └── [id]/
│   │   │           ├── page.tsx              # Граф + статусы + gates
│   │   │           └── agent/
│   │   │               └── [name]/
│   │   │                   └── page.tsx      # Детали агента
│   │   ├── components/
│   │   │   ├── PipelineGraph.tsx             # React Flow граф
│   │   │   ├── AgentNode.tsx                 # Кастомный узел графа
│   │   │   ├── GatePanel.tsx                 # Панель gate-решений
│   │   │   ├── ProjectCard.tsx               # Карточка проекта
│   │   │   └── StatusBadge.tsx               # Статус-индикатор
│   │   └── lib/
│   │       ├── state.ts                      # Чтение JSON state
│   │       └── types.ts                      # TypeScript типы
│   └── public/
│
├── projects/                                  # Артефакты (gitignored)
├── docs/
├── .gitignore
└── CLAUDE.md
```

## State Machine

Каждый проект хранит состояние в `orchestrator/state/{project_id}.json`:

```json
{
  "project_id": "string",
  "created_at": "ISO 8601",
  "mode": "auto | human_approval",
  "status": "running | paused_at_gate | completed | failed",
  "current_gate": "null | gate_1_build | gate_2_architecture | gate_3_go_nogo",
  "pipeline_graph": {
    "nodes": ["agent-id", ...],
    "edges": [["from", "to"], ...],
    "parallel_groups": [["agent-a", "agent-b"], ...]
  },
  "agents": {
    "agent-id": {
      "status": "completed | running | pending | skipped",
      "started_at": "ISO 8601 | null",
      "completed_at": "ISO 8601 | null",
      "artifacts": ["relative/path.md", ...],
      "error": "string | null"
    }
  },
  "gate_decisions": {
    "gate_1_build": {
      "decision": "go | pivot | stop",
      "decided_by": "human",
      "timestamp": "ISO 8601",
      "notes": "string"
    },
    "gate_2_architecture": {
      "decision": "go | revise | stop"
    },
    "gate_3_go_nogo": {
      "decision": "go | no-go | rollback"
    }
  },
  "schema_version": 1
}
```

### Режимы работы

- **auto** — агенты запускаются цепочкой автоматически, остановки только на 3 gate-точках
- **human_approval** — после каждого агента пауза, ждём подтверждения человека

Режим задаётся при создании проекта и может быть переключён через дашборд в любой момент.

### Цикл оркестратора (engine.py)

1. Читает state, находит агентов с выполненными зависимостями (все входящие рёбра → completed)
2. Запускает готовых агентов параллельно через Claude Code Agent tool
3. Каждый агент получает system-prompt.md + rules.md + артефакты зависимостей
4. Артефакты сохраняются в `projects/{project_id}/{phase}/{agent}/`
5. На gate — пауза, записывает `status: paused_at_gate`, ждёт решение (через дашборд POST API или CLI)
6. При ошибке агента: retry 1 раз, при повторной ошибке — `status: failed`, пайплайн останавливается
7. Повторяет до завершения графа или ошибки

### Human Gates

| Gate | Расположение | Решения |
|------|-------------|---------|
| Gate 1: Строим? | После PO (бриф готов), перед Pipeline Architect | go / pivot / stop |
| Gate 2: Архитектура | После System Architect + UX/UI Designer, перед Tech Lead | go / revise / stop |
| Gate 3: Go/No-go | После QA + Security + DevOps, перед Release Manager | go / no-go / rollback |

## Pipeline Architect (мета-агент)

Получает бриф от PO и собирает динамический граф. Правила включения агентов:

| Условие | Агенты |
|---------|--------|
| Есть ПД | Legal обязателен |
| Есть платежи | Security + Legal |
| Публичный продукт | Marketing ветка (Marketer + SMM + Content) |
| Внутренний инструмент | Без маркетинговой ветки |
| MVP | Минимальный набор (8-9 узлов) |
| Production | Полный набор |

Примеры конфигураций:
- **MVP микро-SaaS (9):** Problem → Market → PO → BA → Backend + Frontend → DevOps → QA → Content
- **Landing + Waitlist (8):** Problem → Market → PO → Designer → Frontend → DevOps → Marketer → Content
- **Финтех (все 21):** Все агенты + Legal обязателен + Security обязателен
- **Внутренний инструмент (9):** PO → BA → Architect → Tech Lead → Backend + Frontend → QA → DevOps → Release

## Дашборд (Next.js)

### Стек
- Next.js 15 (App Router)
- React Flow — интерактивный граф
- Tailwind CSS
- File-based state через API routes (GET читает JSON из orchestrator/state/, POST записывает gate-решения)
- Polling каждые 3 секунды

### Страницы
- `/` — список проектов, создание нового
- `/project/[id]` — граф пайплайна + gate controls
- `/project/[id]/agent/[name]` — детали, артефакты, логи

### Цветовая схема узлов
- Серый (#9CA3AF) — pending
- Синий (#3B82F6) — running
- Зелёный (#10B981) — completed
- Красный (#EF4444) — failed
- Жёлтый (#F59E0B) — paused (gate)
- Пунктирная граница — skipped

## Формат промптов агентов

### system-prompt.md
```markdown
---
name: Agent Name
role: Описание роли
phase: research | product | legal | design | development | quality | release | marketing | feedback
automation_level: "N%"
inputs:
  - type: artifact_type
    from: agent-id
    description: что получает
outputs:
  - type: artifact_type
    filename: output.md
    description: что создаёт
tools:
  - tool_name
dependencies:
  - agent-id
---

# Роль
...

# Инструкции
...

# Формат выхода
...
```

### rules.md
```markdown
---
name: Agent Name Rules
type: constraints
---

# Обязательные правила
...

# Запреты
...

# Формат артефактов
...

# Критерии завершения
...
```

### skills/
Пустая папка для будущих расширений — специализированные скиллы каждого агента.

## Git

### .gitignore
```
projects/
node_modules/
.next/
__pycache__/
*.pyc
.env
.env.local
orchestrator/state/*.json
dashboard/.next/
```

### CLAUDE.md
Контекстный файл с описанием структуры, режимов работы и инструкциями для Claude Code.

## Создание проекта

1. Пользователь вводит идею/домен через дашборд (форма: название, описание, тип продукта)
2. Статическая цепочка запускается: Problem Researcher → Market Researcher → PO
3. PO формирует бриф
4. **Gate 1** — человек решает: строим / пивотим / отказываемся
5. Pipeline Architect получает бриф, собирает граф из нужных агентов
6. Orchestrator запускает динамический пайплайн

## Формат артефактов

- Все артефакты — Markdown файлы
- Путь: `projects/{project_id}/{phase}/{agent-name}/{filename}.md`
- `automation_level` в frontmatter — информационное поле, показывает ожидаемую долю автоматизации

## Обработка ошибок

- Агент упал → 1 автоматический retry
- Повторная ошибка → agent.status = "failed", pipeline.status = "failed"
- Человек может перезапустить агент через дашборд или исправить проблему и продолжить

## Список агентов (21)

### Мета-агенты
1. **Pipeline Architect** — компилятор: собирает граф из нужных агентов
2. **Orchestrator** — runtime: управляет выполнением графа

### Фаза: Исследование
3. **Problem Researcher** — поиск реальных болей ЦА (100% автоматизация)
4. **Market Researcher** — валидация спроса, конкуренты, TAM/SAM/SOM (80-90%)

### Фаза: Продукт
5. **Product Owner** — видение, приоритизация, MVP scope (60%)
6. **Business Analyst** — use cases, user stories, acceptance criteria (85-90%)

### Фаза: Юридическое
7. **Legal / Compliance** — ПД, оферта, лицензирование (30-40%)

### Фаза: Дизайн
8. **UX/UI Designer** — wireframes, прототипы, UI-макеты (60-70%)

### Фаза: Разработка
9. **System Architect** — стек, сервисы, схема данных, API (50-60%)
10. **Tech Lead** — декомпозиция задач, спринты, стандарты (65%)
11. **Backend Developer** — API, бизнес-логика, БД (70-90%)
12. **Frontend Developer** — UI по макетам и API-контрактам (70-85%)
13. **DevOps Engineer** — CI/CD, инфра, мониторинг (75%)

### Фаза: Качество
14. **QA Engineer** — тест-кейсы, автотесты, баг-репорты (75-80%)
15. **Security Engineer** — пентест, OWASP, аудит (40-50%)

### Фаза: Релиз
16. **Release Manager** — фиче-флаги, канарейки, rollback (30%)

### Фаза: Маркетинг
17. **Product Marketer** — GTM, позиционирование, лендинг (75-85%)
18. **SMM Manager** — дистрибуция контента по каналам (85-90%)
19. **Content Creator** — посты, видео-скрипты, кейсы (85-90%)

### Фаза: Фидбек
20. **Customer Support** — обратная связь, NPS, FAQ-бот (60%)
21. **Data Analyst** — метрики, когорты, юнит-экономика (70-80%)
