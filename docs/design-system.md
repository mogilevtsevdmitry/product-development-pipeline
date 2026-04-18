# Product Pipeline Design System

Дизайн-язык дашборда Product Development Pipeline. Используется как источник правды для UI и как skill-гайд для агентов UX/UI Designer, Frontend Developer, Content Creator, Product Marketer, SMM Manager.

**Токены:** см. [`dashboard/src/app/design-tokens.css`](../dashboard/src/app/design-tokens.css) — все цвета, типографика, spacing, radii, shadows, motion как CSS-переменные.
**Иконки-sprite:** [`dashboard/public/icons.svg`](../dashboard/public/icons.svg).

---

## CONTENT FUNDAMENTALS

Voice is pragmatic, direct, technical — тон open-source инструмента, не SaaS-продукта. Copy — **русский язык по умолчанию** с English mirror.

- **Лицо:** повелительное / второе лицо («Опишите идею», «Создайте блок», «Подтвердите продолжение»). Никакого «мы / we».
- **Регистр:** **sentence case** везде. Не Title Case. Даже CTA: «Новый проект», не «Новый Проект».
- **Длина:** коротко. Кнопки 1–3 слова. Empty state — одно предложение + один CTA.
- **Числа:** всегда видимы, без воды. Прогресс — `3 / 12` с процентом. Стоимость — `$0.42`. Токены — `3.4K`, `1.2M`.
- **Технические термины — по-английски:** `go / stop / pivot`, `go / no-go`, `rollback`, `gate`, `DAG`, `MCP`, `API`, `MVP`. Русская рамка вокруг них.
- **Эмодзи:** **используем намеренно** как иконографию в меню, переключателях режимов, заголовках gate, статус-чипах. НЕ декор — всегда в паре с текстом. См. каталог ниже.
- **Пунктуация:** «ёлочки» для кавычек: «Строим?», «Архитектура». Тире — em-dash для вставок. En-dash `–` не используем.
- **Ошибки:** конкретно. «Не удалось отправить сообщение», «Ошибка создания проекта», «Ничего не найдено».
- **Плейсхолдеры:** с примером. «Например: AI Writing Assistant», «Опишите идею продукта, целевую аудиторию, проблему…».

### Примеры из кода

- Таглайн главной: «Управление продуктовым пайплайном»
- Empty state: «Нет проектов · Создайте первый проект, чтобы начать работу с пайплайном»
- Gate 1: «Проблема реальна, рынок существует, есть смысл инвестировать в разработку?»
- Chat hint: `«Создай блок Тренды с агентом trend-researcher»`
- Mode toggle: «🤖 Автоматический · Агенты работают автономно, остановки только на gate-точках»

---

## VISUAL FOUNDATIONS

**Dark-first, grid-based, data-dense.** Канвас `#030712`, карточки `#111827`/`#1f2937`. Плотность важнее декора — это инструмент, не сторителлинг.

### Палитра

- **Серый — главный.** Tailwind gray 950 → 50 делает 80% работы: фоны, бордеры, текст.
- **Акценты функциональны.** Blue = primary action. Emerald = success. Amber = waiting / warning. Red = error / stop. Violet/cyan/sky/rose/pink/teal = тэги фаз (см. `--phase-*`).
- **Soft-fill chips** — подпись системы: `color/10` fill + `color/20` border + full-strength text. Пример: `bg-emerald-400/10 text-emerald-400 border-emerald-400/20`.
- **Никаких градиентов.** Исключение — sticky header `bg-gray-950/80 backdrop-blur-sm`.
- **Никакого фото/иллюстраций.** Единственное content-изображение — архитектурная диаграмма пайплайна.

### Типографика

- **Семейства:** Inter (400/500/600/700) — UI. JetBrains Mono (400/500/600) — код, ID, `project_id`, счётчики чипов.
- **Шкала:** 11/12/14/16/18/20/24/30/36. Большая часть UI живёт на `14px` (`--text-sm`).
- **Веса:** 400 body, 500 labels, 600 headings/emphasis, 700 только для page titles.
- **Tracking:** 0 везде, кроме `uppercase` eyebrow (tracking-wider, 0.1em).
- **Line-height:** 1.5 body, 1.2 headings, 1.625 prose.

### Layout

- Max-width: `max-w-7xl` (1280px), `px-4 sm:px-6 lg:px-8`.
- Header: `h-14` (56px), sticky, `z-50`, border-bottom, backdrop-blur.
- Card grids: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`, `gap-4`.
- Sidebar: 288px expanded (`w-72`), 48px collapsed (`w-12`), жёсткий border-right.
- Gutters: `py-8` секции, `p-5`/`p-6` карточки.
- Floating chat: `bottom-6 right-6`, 420×600, `rounded-2xl`.

### Радиусы

Мелкие контролы `rounded-md` (6px), кнопки/инпуты `rounded-lg` (8px), карточки `rounded-xl` (12px), hero-карточки и chat-bubble `rounded-2xl` (16px), status pills `rounded-full`. **Никаких pill-кнопок** — CTA всегда `rounded-lg`.

### Бордеры и тени

- Default border: `1px solid var(--gray-800)` — очень subtle.
- Hover: бордер до `--gray-700`, фон `--gray-800/80`.
- Тени редкие: floating chat (`shadow-2xl`), agent nodes (`shadow-lg`), tooltip (`shadow-xl`). У карточек тени нет — только border + фон.
- Status banners: `border-{color}-500/40` + `bg-{color}-500/10` — soft, прозрачно, не opaque.

### Кнопки

- **Primary:** `bg-blue-600 hover:bg-blue-500`, белый текст, `rounded-lg`, `px-4 py-2`, `text-sm font-medium`, `transition-colors`.
- **Secondary/chip:** `bg-gray-800 border border-gray-700` + `hover:bg-gray-700`.
- **Tertiary (text):** `text-gray-400 hover:text-gray-300`.
- **Destructive:** `bg-red-600 hover:bg-red-500`.
- **Disabled:** `opacity-50 cursor-not-allowed`.
- **Icon buttons:** 24–28px, `rounded-md`, без бордера, hover `bg-gray-700`.

### Инпуты

`bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent`. Label — сверху, `14px medium gray-300`.

### Hover / focus

- Hover: подсветить фон на шаг (`gray-900 → gray-800/80`) или текст (`gray-400 → gray-300`). Без scale и shadow-lift.
- Focus: `ring-2 ring-blue-500` на инпутах. На кнопках outline нет.
- Cursor: `cursor-pointer` на интерактивном не-`<button>`; `cursor-not-allowed` на disabled; `cursor-grab`/`active:cursor-grabbing` на draggable.

### Motion

Тихо и функционально. `transition-colors` ~150ms default. Progress-бары — 300–500ms. Один keyframe — `pulse-dot` 1.5s ease-in-out для live-индикаторов. React Flow edges: `animated={true}` для running агентов. Никаких bounce/spring/confetti.

### Карточки

`rounded-xl border border-gray-800 bg-gray-900 p-5 (или p-6)`. Hover: `border-gray-700 bg-gray-800/80`. Опциональный top-right badge. Опциональный bottom-border divider с метаданными.

### Фиксированные паттерны

Sticky top header, sticky left sidebar, floating bottom-right chat. Кнопка «+ Новый проект» — top-right контента, не floating.

---

## ICONOGRAPHY

Три параллельные icon-системы:

1. **Inline SVG** — 16×16, `stroke="currentColor" strokeWidth="1.5"`, rounded caps. Add, edit, delete, chevrons, send, check, close, lock, star, search, spinner. Никогда из библиотек — всё inline. Sprite: [`dashboard/public/icons.svg`](../dashboard/public/icons.svg).
2. **Emoji** — first-class иконки в labels, toggles, gate titles, chips. Всегда с текстом.
3. **Status dots** — 8×8 круги, цвет по статусу, опционально pulsing. Главный индикатор прогресса, не спиннер.

**Никакого icon-font, Heroicons, Lucide.** Новые иконки — в том же стиле: 16×16, stroke 1.5, rounded caps.

### Каталог эмодзи

| Emoji | Использование |
|---|---|
| 🚦 | Gate 1 / general gate marker |
| 🏗️ | Gate 2 / architecture |
| 🚀 | Gate 3 / release |
| 🤖 | Automatic mode |
| 👤 | Human approval mode |
| ⚡ | Debate pipeline type |
| 🏗 | Standard pipeline type |
| 🔭 | Analyst role (debates) |
| ⚒️ | Producer role |
| 🔍 | Controller / search |
| 📁 📂 | Project folder picker |
| 📦 | Empty state |
| ✅ | Go / success |
| ⛔ | Stop |
| 🔄 | Pivot / revise / restart |
| ⏸ ⏹ ▶ | Agent run controls |
| ✕ ✓ | Close / confirm |
| ⏳ | Loading |
| 💬 | Chat |
| 🇷🇺 🇬🇧 | Language switchers in README |

---

## Семантические токены (сокращённо)

Полный список — в `design-tokens.css`.

- **Surfaces:** `--bg-primary`, `--bg-surface`, `--bg-surface-2`, `--bg-surface-3`, `--bg-overlay`
- **Text:** `--fg-primary`, `--fg-secondary`, `--fg-muted`, `--fg-subtle`, `--fg-faint`
- **Borders:** `--border-default`, `--border-strong`, `--border-subtle`
- **Action:** `--accent`, `--accent-hover`, `--accent-soft-bg`, `--accent-soft-fg`
- **Status:** `--status-success`, `--status-running`, `--status-warning`, `--status-error`, `--status-pending` (+ `-bg` варианты)
- **Phase (11 фаз агентов):** `--phase-research`, `--phase-product`, `--phase-meta`, `--phase-legal`, `--phase-design`, `--phase-development`, `--phase-quality`, `--phase-release`, `--phase-marketing`, `--phase-feedback`, `--phase-content`
