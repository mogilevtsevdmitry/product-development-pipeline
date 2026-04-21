"""
Verdict-loop: парсинг вердикта агента из SUMMARY.md и оркестрация rework.

Архитектура:
- Каждый агент пишет в YAML frontmatter SUMMARY.md поля:
  - verdict: go | no-go | needs_rework | n/a
  - blockers: список с severity/description/assignee
  - feedback_for: кому отправить на доработку
- После завершения агента engine вызывает handle_verdict(state, agent_id).
- Если verdict in (no-go, needs_rework):
  - Назначенные агенты переводятся в pending
  - В state.rework_log добавляется запись (round, who, by, blockers)
  - Если rework_round превысил max_rework_rounds → пайплайн ставится на
    верdict-gate, человек решает override / accept / stop.
- Verdict go или n/a — игнорируется.
"""

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import yaml

from config import PROJECTS_DIR, get_agent_phase
from context_manager import SUMMARY_FILENAME, append_decision

MAX_REWORK_ROUNDS = 3
VERDICT_GATE_NAME = "verdict_blocked"


@dataclass
class Blocker:
    id: str
    severity: str
    description: str
    assignee: Optional[str]


@dataclass
class Verdict:
    agent_id: str
    value: str                      # go | no-go | needs_rework | n/a
    summary: str
    blockers: List[Blocker] = field(default_factory=list)
    feedback_for: List[Dict[str, str]] = field(default_factory=list)

    @property
    def is_block(self) -> bool:
        return self.value in ("no-go", "needs_rework")


@dataclass
class ReworkAction:
    """Что engine должен сделать после verdict."""
    triggered: bool
    reset_agents: List[str] = field(default_factory=list)
    rework_round: int = 0
    feedback_text: str = ""           # положим в state[agents][reset_agent].rework_feedback
    pause_at_gate: bool = False       # True если превысили MAX_REWORK_ROUNDS
    reason: str = ""


def save_verdict_to_state(state: Dict[str, Any], agent_id: str) -> Optional[Verdict]:
    """Читает SUMMARY.md агента и сохраняет verdict в state.agents[agent_id].

    Возвращает Verdict если он был распарсен, иначе None. Используется engine
    для отображения вердикта в UI даже когда verdict=go (без rework).
    """
    summary_path = _summary_path_for(state["project_id"], agent_id)
    verdict = parse_verdict(summary_path, agent_id)
    a = state.get("agents", {}).get(agent_id)
    if a is None:
        return verdict
    if verdict is None:
        a["verdict"] = None
        a["verdict_summary"] = None
    else:
        a["verdict"] = verdict.value
        a["verdict_summary"] = verdict.summary or None
    return verdict


def parse_verdict(summary_path: Path, agent_id: str) -> Optional[Verdict]:
    """Извлекает verdict из YAML frontmatter SUMMARY.md."""
    if not summary_path.exists():
        return None
    text = summary_path.read_text(encoding="utf-8")
    fm = _extract_frontmatter(text)
    if not fm:
        return None

    value = str(fm.get("verdict", "n/a")).strip().lower()
    if value not in ("go", "no-go", "needs_rework", "n/a"):
        return None

    blockers_raw = fm.get("blockers") or []
    blockers: List[Blocker] = []
    if isinstance(blockers_raw, list):
        for b in blockers_raw:
            if not isinstance(b, dict):
                continue
            blockers.append(Blocker(
                id=str(b.get("id", "")),
                severity=str(b.get("severity", "")).lower(),
                description=str(b.get("description", "")),
                assignee=b.get("assignee"),
            ))

    feedback_raw = fm.get("feedback_for") or []
    feedback_for: List[Dict[str, str]] = []
    if isinstance(feedback_raw, list):
        for f in feedback_raw:
            if isinstance(f, dict) and f.get("agent"):
                feedback_for.append({
                    "agent": str(f["agent"]),
                    "reason": str(f.get("reason", "")),
                    "issues_ref": str(f.get("issues_ref", "")),
                })

    return Verdict(
        agent_id=agent_id,
        value=value,
        summary=str(fm.get("verdict_summary", "")),
        blockers=blockers,
        feedback_for=feedback_for,
    )


def handle_verdict(state: Dict[str, Any], agent_id: str) -> ReworkAction:
    """Главная точка: вызывается engine после успешного завершения агента.

    Возвращает action; engine применяет его (сбрасывает агентов, ставит на gate и т.п.).
    """
    summary_path = _summary_path_for(state["project_id"], agent_id)
    verdict = parse_verdict(summary_path, agent_id)

    if verdict is None or not verdict.is_block:
        return ReworkAction(triggered=False)

    assignees = _resolve_assignees(verdict, state)
    if not assignees:
        # Verdict негативный, но некого возвращать — превращаем в gate-stop
        return ReworkAction(
            triggered=True,
            reset_agents=[],
            pause_at_gate=True,
            reason=f"{agent_id} → {verdict.value}; не указаны feedback_for[].agent. "
                   f"Нужно решение человека.",
        )

    # Определяем round: считаем сколько раз reset делали для этих агентов
    rework_log: List[Dict[str, Any]] = state.setdefault("rework_log", [])
    same_loop = [
        r for r in rework_log
        if r.get("by") == agent_id and set(r.get("reset", [])) == set(assignees)
    ]
    round_num = len(same_loop) + 1

    if round_num > MAX_REWORK_ROUNDS:
        return ReworkAction(
            triggered=True,
            reset_agents=[],
            rework_round=round_num,
            pause_at_gate=True,
            reason=f"{agent_id} → {verdict.value}; превышен лимит rework "
                   f"({MAX_REWORK_ROUNDS}). Решение человека: override / stop.",
        )

    # Готовим feedback-текст для контекста перезапускаемых агентов
    feedback_text = _format_feedback(verdict, agent_id, round_num)

    return ReworkAction(
        triggered=True,
        reset_agents=assignees,
        rework_round=round_num,
        feedback_text=feedback_text,
        pause_at_gate=False,
        reason=f"{agent_id} → {verdict.value} (round {round_num}/{MAX_REWORK_ROUNDS})",
    )


def apply_action(
    state: Dict[str, Any],
    by_agent: str,
    action: ReworkAction,
) -> None:
    """Применяет action к state: сбрасывает агентов, ведёт rework_log, выставляет паузу."""
    if not action.triggered:
        return

    timestamp = datetime.now(timezone.utc).isoformat()

    # Запись в rework_log
    rework_log: List[Dict[str, Any]] = state.setdefault("rework_log", [])
    rework_log.append({
        "by": by_agent,
        "reset": list(action.reset_agents),
        "round": action.rework_round,
        "reason": action.reason,
        "timestamp": timestamp,
        "pause": action.pause_at_gate,
    })

    # Сброс агентов на повторное выполнение + и downstream-зависимостей
    affected: Set[str] = set()
    for aid in action.reset_agents:
        affected.update(_collect_downstream(state, aid))
    affected.update(action.reset_agents)
    # Сам verdict-автор тоже должен повторно проверить после rework
    affected.add(by_agent)

    for aid in affected:
        if aid not in state["agents"]:
            continue
        a = state["agents"][aid]
        a["status"] = "pending"
        a["started_at"] = None
        a["completed_at"] = None
        a["error"] = None
        # Артефакты не трогаем — они служат предыдущим контекстом для нового прохода

    # Подкладываем feedback в перезапускаемых агентов через rework_feedback
    for aid in action.reset_agents:
        if aid in state["agents"]:
            state["agents"][aid]["rework_feedback"] = action.feedback_text
            state["agents"][aid]["rework_round"] = action.rework_round

    # Если превышен лимит — ставим verdict-gate
    if action.pause_at_gate:
        state["status"] = "paused_at_gate"
        state["current_gate"] = VERDICT_GATE_NAME
        state["verdict_block"] = {
            "by": by_agent,
            "reason": action.reason,
            "round": action.rework_round,
        }
    else:
        state["status"] = "running"

    # Запись в DECISIONS.md — для прозрачности
    try:
        append_decision(
            project_id=state["project_id"],
            agent_id=by_agent,
            title=f"Verdict {action.reason.split(';')[0]} — rework",
            rationale=action.reason,
            consequences=(
                f"Сброшены в pending: {', '.join(sorted(affected))}. "
                f"Round {action.rework_round}/{MAX_REWORK_ROUNDS}."
                if not action.pause_at_gate else
                f"Лимит rework исчерпан. Пауза на gate `{VERDICT_GATE_NAME}`."
            ),
        )
    except Exception:
        pass


def get_rework_feedback(state: Dict[str, Any], agent_id: str) -> Optional[str]:
    """Возвращает rework_feedback для агента (engine инжектит в его промпт)."""
    return state.get("agents", {}).get(agent_id, {}).get("rework_feedback")


def clear_rework_feedback(state: Dict[str, Any], agent_id: str) -> None:
    """Сбрасывает rework_feedback после того как агент его получил."""
    a = state.get("agents", {}).get(agent_id)
    if a and "rework_feedback" in a:
        del a["rework_feedback"]


# =============================================================================
# Внутренние утилиты
# =============================================================================

def _summary_path_for(project_id: str, agent_id: str) -> Path:
    try:
        phase = get_agent_phase(agent_id)
    except ValueError:
        phase = "unknown"
    return PROJECTS_DIR / project_id / phase / agent_id / SUMMARY_FILENAME


def _extract_frontmatter(text: str) -> Optional[Dict[str, Any]]:
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
    if not m:
        return None
    try:
        data = yaml.safe_load(m.group(1))
        if isinstance(data, dict):
            return data
    except yaml.YAMLError:
        return None
    return None


def _resolve_assignees(verdict: Verdict, state: Dict[str, Any]) -> List[str]:
    """Кого возвращать на rework: feedback_for[].agent → blockers[].assignee → upstream."""
    candidates: List[str] = []
    seen: Set[str] = set()

    for f in verdict.feedback_for:
        aid = f.get("agent")
        if aid and aid in state.get("agents", {}) and aid not in seen:
            candidates.append(aid)
            seen.add(aid)
    for b in verdict.blockers:
        if b.assignee and b.assignee in state.get("agents", {}) and b.assignee not in seen:
            candidates.append(b.assignee)
            seen.add(b.assignee)

    # Fallback: upstream-агенты verdict-автора
    if not candidates:
        graph = state.get("pipeline_graph", {})
        for e in graph.get("edges", []):
            if e[1] == verdict.agent_id and e[0] not in seen:
                candidates.append(e[0])
                seen.add(e[0])

    return candidates


def _collect_downstream(state: Dict[str, Any], agent_id: str) -> Set[str]:
    """Все downstream-агенты от заданного в графе (BFS)."""
    graph = state.get("pipeline_graph", {})
    edges = graph.get("edges", [])
    result: Set[str] = set()
    queue = [agent_id]
    while queue:
        cur = queue.pop()
        for e in edges:
            if e[0] == cur and e[1] not in result:
                result.add(e[1])
                queue.append(e[1])
    return result


def _format_feedback(verdict: Verdict, by_agent: str, round_num: int) -> str:
    """Текст для инжекции в промпт перезапускаемых агентов."""
    lines = [
        f"# Доработка по итогам {by_agent} (раунд {round_num})",
        "",
        f"**Вердикт:** {verdict.value.upper()}",
    ]
    if verdict.summary:
        lines.append(f"**Резюме:** {verdict.summary}")
    if verdict.blockers:
        lines.append("\n**Блокеры:**")
        for b in verdict.blockers:
            asg = f" → {b.assignee}" if b.assignee else ""
            lines.append(f"- `{b.id}` ({b.severity}){asg}: {b.description}")
    lines.append(
        "\nИсправь именно эти проблемы; не делай работу заново. "
        "После исправления обнови SUMMARY.md и `produced_artifacts`."
    )
    return "\n".join(lines)
