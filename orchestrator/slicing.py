"""
Slicing для тяжёлых агентов (backend-developer, frontend-developer, qa-engineer).

Подход GSD-2: сначала агент в режиме «планировщик» формирует список slices —
независимых под-задач, помещающихся в одно контекст-окно. Затем оркестратор
запускает каждый slice как отдельный fresh-context вызов Claude Code.

Каждый slice пишет свой SLICE_<n>_SUMMARY.md. После всех slices — общий SUMMARY.md.
"""

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Any, Optional

SLICED_AGENTS = {
    "backend-developer",
    "frontend-developer",
    "qa-engineer",
}

MAX_SLICES = 8  # верхний предел; агент сам решает сколько в реальности

SLICES_PLAN_FILENAME = "slices.json"


def is_sliced(agent_id: str) -> bool:
    return agent_id in SLICED_AGENTS


def build_slicing_plan_prompt(agent_id: str, output_dir: str) -> str:
    """Промпт первой фазы: попросить агента сделать декомпозицию на slices."""
    return (
        f"\n\n# Фаза 1: декомпозиция на slices\n\n"
        f"Прежде чем что-либо делать, разбей свою работу на независимые "
        f"под-задачи (slices), каждая из которых:\n"
        f"- помещается в одно контекстное окно (≈один файл / один эндпойнт / один экран)\n"
        f"- имеет проверяемый критерий «готово» (must-have)\n"
        f"- может быть выполнена без знания деталей других slices, только их summary\n\n"
        f"Запиши план в `{output_dir}/{SLICES_PLAN_FILENAME}`:\n\n"
        f"```json\n"
        f"{{\n"
        f"  \"agent_id\": \"{agent_id}\",\n"
        f"  \"slices\": [\n"
        f"    {{\n"
        f"      \"id\": \"S01\",\n"
        f"      \"title\": \"короткое название\",\n"
        f"      \"goal\": \"что должно появиться по итогу\",\n"
        f"      \"must_have\": [\"критерий 1\", \"критерий 2\"],\n"
        f"      \"depends_on\": []\n"
        f"    }}\n"
        f"  ]\n"
        f"}}\n"
        f"```\n\n"
        f"Максимум {MAX_SLICES} slices. Если задача меньше — делай 1–2 slice.\n"
        f"После записи slices.json — НИЧЕГО БОЛЬШЕ НЕ ДЕЛАЙ. Завершай работу.\n"
    )


def build_slice_execution_prompt(
    agent_id: str,
    slice_def: Dict[str, Any],
    output_dir: str,
    prior_summaries: str,
) -> str:
    """Промпт второй фазы: выполнить конкретный slice в изолированном контексте."""
    slice_id = slice_def["id"]
    summary_file = f"{slice_id}_SUMMARY.md"

    prior_section = ""
    if prior_summaries.strip():
        prior_section = (
            f"\n\n# Контекст: summary предыдущих slices\n\n{prior_summaries}\n"
        )

    return (
        f"\n\n# Slice {slice_id}: {slice_def.get('title', '')}\n\n"
        f"Ты выполняешь ТОЛЬКО этот slice. Не трогай остальное.\n\n"
        f"**Цель:** {slice_def.get('goal', '')}\n\n"
        f"**Must-have критерии:**\n"
        + "\n".join(f"- {m}" for m in slice_def.get("must_have", []))
        + prior_section +
        f"\n\n# Что записать на выходе\n\n"
        f"1. Артефакты slice (код/документы) — в `{output_dir}/`\n"
        f"2. Файл `{output_dir}/{summary_file}` с YAML frontmatter:\n\n"
        f"```markdown\n"
        f"---\n"
        f"slice_id: {slice_id}\n"
        f"agent_id: {agent_id}\n"
        f"status: completed\n"
        f"must_have_met: [список выполненных критериев]\n"
        f"key_decisions: [...]\n"
        f"open_questions: [...]\n"
        f"---\n\n"
        f"# Что сделано в slice {slice_id}\n\n"
        f"Кратко: что появилось, какие решения приняты, что осталось.\n"
        f"```\n"
    )


def read_slices_plan(output_dir: Path) -> Optional[List[Dict[str, Any]]]:
    """Читает slices.json и возвращает список slices (или None если отсутствует/битый)."""
    plan_file = output_dir / SLICES_PLAN_FILENAME
    if not plan_file.exists():
        return None
    try:
        data = json.loads(plan_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None

    slices = data.get("slices", [])
    if not isinstance(slices, list) or not slices:
        return None

    valid: List[Dict[str, Any]] = []
    for s in slices[:MAX_SLICES]:
        if not isinstance(s, dict) or "id" not in s:
            continue
        valid.append(s)
    return valid or None


def collect_prior_summaries(output_dir: Path, current_slice_id: str) -> str:
    """Собирает SUMMARY всех ранее выполненных slices для инжекции в текущий."""
    parts: List[str] = []
    for f in sorted(output_dir.glob("S*_SUMMARY.md")):
        if f.stem.startswith(current_slice_id):
            continue
        parts.append(f"--- {f.name} ---\n{f.read_text(encoding='utf-8')}\n")
    return "\n".join(parts)


def synthesize_final_summary(
    output_dir: Path,
    agent_id: str,
    slices: List[Dict[str, Any]],
) -> None:
    """Сводит все SLICE_*_SUMMARY.md в общий SUMMARY.md агента."""
    timestamp = datetime.now(timezone.utc).isoformat()
    summary_path = output_dir / "SUMMARY.md"

    slice_summaries: List[str] = []
    for s in slices:
        sid = s["id"]
        sf = output_dir / f"{sid}_SUMMARY.md"
        title = s.get("title", "")
        if sf.exists():
            slice_summaries.append(
                f"### {sid} — {title}\n\n{_extract_summary_body(sf)}"
            )
        else:
            slice_summaries.append(
                f"### {sid} — {title}\n\n_не выполнен_"
            )

    content = (
        f"---\n"
        f"agent_id: {agent_id}\n"
        f"status: completed\n"
        f"sliced: true\n"
        f"slices_count: {len(slices)}\n"
        f"generated_at: {timestamp}\n"
        f"---\n\n"
        f"# Итог работы {agent_id}\n\n"
        f"Работа выполнена через slicing — {len(slices)} независимых под-задач, "
        f"каждая в собственном контекст-окне.\n\n"
        f"## Slices\n\n"
        + "\n\n".join(slice_summaries)
    )
    summary_path.write_text(content, encoding="utf-8")


def _extract_summary_body(slice_summary_file: Path) -> str:
    """Возвращает тело SUMMARY (после YAML-frontmatter)."""
    text = slice_summary_file.read_text(encoding="utf-8")
    # Убираем frontmatter --- ... ---
    m = re.match(r"^---\n.*?\n---\n+(.*)$", text, re.DOTALL)
    return (m.group(1) if m else text).strip()
