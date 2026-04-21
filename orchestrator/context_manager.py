"""
Управление контекстом агентов: SUMMARY.md и DECISIONS.md.

Реализует подход GSD-2: каждый агент пишет короткое summary,
downstream-агенты получают summary вместо полного артефакта.
DECISIONS.md — append-only журнал архитектурных решений,
автоматически инжектится во всех downstream-агентов.
"""

from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Any, Optional

from config import PROJECTS_DIR

SUMMARY_FILENAME = "SUMMARY.md"
DECISIONS_FILENAME = "DECISIONS.md"
FULL_MARKER = "*full*"  # маркер в edge-фильтре: «передавать все артефакты»


def get_summary_path(project_id: str, agent_id: str, phase: str) -> Path:
    """Путь до SUMMARY.md конкретного агента."""
    return PROJECTS_DIR / project_id / phase / agent_id / SUMMARY_FILENAME


def get_decisions_path(project_id: str) -> Path:
    """Путь до проектного DECISIONS.md."""
    return PROJECTS_DIR / project_id / DECISIONS_FILENAME


def read_decisions(project_id: str) -> str:
    """Читает DECISIONS.md проекта. Возвращает пустую строку если нет."""
    path = get_decisions_path(project_id)
    if path.exists():
        return path.read_text(encoding="utf-8")
    return ""


def append_decision(
    project_id: str,
    agent_id: str,
    title: str,
    rationale: str,
    consequences: str = "",
) -> None:
    """Append-only запись архитектурного решения в DECISIONS.md.

    Используется агентами через инструкции в промпте; здесь — программный API
    для инфраструктурных решений (например, slicing).
    """
    path = get_decisions_path(project_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).isoformat()

    if not path.exists():
        path.write_text(
            "# Архитектурные решения проекта\n\n"
            "Append-only журнал. Источник правды для всех downstream-агентов.\n\n",
            encoding="utf-8",
        )

    entry = (
        f"\n---\n\n"
        f"## {title}\n\n"
        f"- **Принято:** {agent_id}\n"
        f"- **Когда:** {timestamp}\n\n"
        f"**Обоснование:** {rationale}\n\n"
    )
    if consequences:
        entry += f"**Последствия:** {consequences}\n\n"

    with path.open("a", encoding="utf-8") as f:
        f.write(entry)


def collect_input_context(
    project_id: str,
    agent_id: str,
    state: Dict[str, Any],
    pipeline_graph: Dict[str, Any],
) -> str:
    """Собирает контекст для агента: summary зависимостей + явные артефакты.

    Правила:
    - Если у edge нет фильтра → передаём только SUMMARY.md зависимости.
    - Если фильтр содержит "*full*" → передаём все артефакты.
    - Если фильтр — список файлов → передаём именно их (legacy-поведение).
    - Если SUMMARY.md ещё не сгенерирован — fallback на полные артефакты.
    """
    project_dir = PROJECTS_DIR / project_id
    agents_state = state.get("agents", {})
    parts: List[str] = []

    for edge in pipeline_graph.get("edges", []):
        if edge[1] != agent_id:
            continue

        dep_id = edge[0]
        dep_state = agents_state.get(dep_id, {})
        if dep_state.get("status") != "completed":
            continue

        dep_artifacts: List[str] = list(dep_state.get("artifacts", []))
        if not dep_artifacts:
            continue

        # Определяем режим передачи
        edge_filter = edge[2] if len(edge) > 2 else None

        if edge_filter == []:
            # Явный пустой список — ничего не передавать
            continue

        selected: List[str] = []
        if edge_filter is None:
            # Дефолт: только SUMMARY.md зависимости
            summary_match = [a for a in dep_artifacts if a.endswith(SUMMARY_FILENAME)]
            if summary_match:
                selected = summary_match
            else:
                # Fallback: SUMMARY ещё не было сгенерировано
                selected = dep_artifacts
        elif FULL_MARKER in edge_filter:
            selected = dep_artifacts
        else:
            selected = [
                a for a in dep_artifacts
                if any(a.endswith(name) for name in edge_filter)
            ]

        for artifact_rel in selected:
            full_path = project_dir / artifact_rel
            if not full_path.exists():
                continue
            content = full_path.read_text(encoding="utf-8")
            parts.append(
                f"--- Артефакт от {dep_id}: {artifact_rel} ---\n{content}\n"
            )

    return "\n".join(parts)


def build_summary_instruction(agent_id: str, output_dir: str) -> str:
    """Инструкция агенту обязательно сформировать SUMMARY.md с verdict-блоком."""
    return (
        f"\n\n# ОБЯЗАТЕЛЬНО: SUMMARY.md с вердиктом\n\n"
        f"После выполнения работы создай файл `{output_dir}/{SUMMARY_FILENAME}` "
        f"в следующем формате (YAML frontmatter + markdown):\n\n"
        f"```markdown\n"
        f"---\n"
        f"agent_id: {agent_id}\n"
        f"status: completed              # технический статус: completed | failed\n"
        f"verdict: go                    # СОДЕРЖАТЕЛЬНЫЙ вердикт: см. правила ниже\n"
        f"verdict_summary: \"Кратко: почему такой вердикт (1 строка)\"\n"
        f"blockers: []                   # если verdict != go — заполнить\n"
        f"feedback_for: []               # если verdict != go — кому передать на доработку\n"
        f"key_decisions:\n"
        f"  - ключевые решения, принятые в ходе работы\n"
        f"produced_artifacts:\n"
        f"  - список созданных файлов (без полного пути)\n"
        f"open_questions:\n"
        f"  - что осталось нерешённым\n"
        f"handoff:\n"
        f"  - что важно знать следующему агенту\n"
        f"---\n\n"
        f"# Краткое резюме работы\n\n"
        f"2–5 абзацев: что сделал, на чём остановился, что критично для downstream.\n"
        f"```\n\n"
        f"## Правила verdict\n\n"
        f"- `go` — работа выполнена, downstream-агенты могут продолжать.\n"
        f"- `needs_rework` — найдены проблемы, которые должны быть исправлены конкретным "
        f"upstream-агентом, но не критичны для остановки пайплайна. Заполни `blockers` "
        f"и `feedback_for`. Engine автоматически сбросит указанных агентов в pending "
        f"и передаст им твой feedback.\n"
        f"- `no-go` — критичные блокеры; пайплайн НЕ должен идти дальше без исправления. "
        f"Заполни `blockers` (severity: critical) и `feedback_for`. Если лимит rework "
        f"исчерпан — engine остановится на verdict-gate и спросит человека.\n"
        f"- `n/a` — для агентов, чья работа не предполагает оценочного вердикта "
        f"(исследователи, маркетинг, дизайн). Используй когда тебя нечего \"провалить\".\n\n"
        f"## Формат blockers / feedback_for (при verdict != go)\n\n"
        f"```yaml\n"
        f"blockers:\n"
        f"  - id: BUG-001                # стабильный идентификатор\n"
        f"    severity: critical          # critical | high | medium | low\n"
        f"    description: \"Что именно сломано (одно предложение)\"\n"
        f"    assignee: backend-developer # кто должен исправить\n"
        f"feedback_for:\n"
        f"  - agent: backend-developer    # кому передать на rework\n"
        f"    reason: \"Почему именно этому агенту\"\n"
        f"    issues_ref: report.md#section  # где детали\n"
        f"```\n\n"
        f"SUMMARY.md — главный канал передачи контекста и **точка контроля качества**. "
        f"Engine читает `verdict` + `blockers` + `feedback_for` и автоматически решает, "
        f"идти дальше или вернуть на доработку. Не пиши `verdict: go` если есть "
        f"критичные проблемы — это сломает downstream.\n"
    )


def build_rework_section(rework_feedback: str) -> str:
    """Секция, которую engine инжектит при повторном запуске агента после rework."""
    return (
        f"\n\n# 🔁 Повторный запуск (rework)\n\n"
        f"Это НЕ первый запуск. Предыдущий проверяющий агент вернул работу "
        f"на доработку. Ниже — его feedback. Сфокусируйся ТОЛЬКО на исправлении "
        f"перечисленных проблем, не переделывай всё с нуля.\n\n"
        f"{rework_feedback}\n"
    )


def build_decisions_instruction(project_id: str) -> str:
    """Инструкция агенту фиксировать архитектурные решения."""
    decisions_path = get_decisions_path(project_id)
    return (
        f"\n\n# Архитектурные решения\n\n"
        f"Если ты принимаешь решение, влияющее на downstream-агентов "
        f"(выбор стека, изменение контракта, отказ от опции), "
        f"добавь запись в append-only файл `{decisions_path}` в формате:\n\n"
        f"```markdown\n"
        f"---\n\n"
        f"## <Краткий заголовок решения>\n\n"
        f"- **Принято:** <твой agent_id>\n"
        f"- **Когда:** <ISO timestamp>\n\n"
        f"**Обоснование:** ...\n\n"
        f"**Последствия:** ...\n"
        f"```\n\n"
        f"Не переписывай существующие записи. Только append.\n"
    )


def ensure_summary_exists(
    output_dir: Path,
    agent_id: str,
    artifacts: List[str],
) -> None:
    """Если агент не создал SUMMARY.md — синтезируем заглушку.

    Это страховка: downstream-агенты не должны падать из-за того,
    что upstream забыл написать summary.
    """
    summary_path = output_dir / SUMMARY_FILENAME
    if summary_path.exists():
        return

    timestamp = datetime.now(timezone.utc).isoformat()
    content = (
        f"---\n"
        f"agent_id: {agent_id}\n"
        f"status: completed\n"
        f"auto_generated: true\n"
        f"generated_at: {timestamp}\n"
        f"produced_artifacts:\n"
    )
    for art in artifacts:
        content += f"  - {Path(art).name}\n"
    content += (
        f"---\n\n"
        f"# Авто-сгенерированный SUMMARY\n\n"
        f"Агент `{agent_id}` не создал SUMMARY.md самостоятельно. "
        f"Это заглушка — downstream-агентам следует читать полные артефакты.\n"
    )
    summary_path.write_text(content, encoding="utf-8")
