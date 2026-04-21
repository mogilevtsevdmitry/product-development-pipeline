"""
Запуск агентов пайплайна.

Каждый агент получает system-prompt.md + rules.md + summary зависимостей
+ DECISIONS.md проекта. На выходе агент пишет SUMMARY.md (страховка —
автогенерация заглушки если забыл).

Тяжёлые агенты (см. SLICED_AGENTS) запускаются в режиме slicing:
сначала декомпозиция на под-задачи, затем каждая под-задача — отдельный
fresh-context вызов Claude Code.

Каждый запуск ограничен per-agent budget (общий timeout + max_idle).
"""

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Any, Optional

from config import (
    BASE_DIR,
    PROJECTS_DIR,
    get_agent_dir,
    get_agent_phase,
)
from context_manager import (
    SUMMARY_FILENAME,
    build_summary_instruction,
    build_decisions_instruction,
    collect_input_context,
    ensure_summary_exists,
    read_decisions,
)
from budget import (
    AgentAuthError,
    AgentRateLimited,
    AgentStuck,
    AgentTimeout,
    get_budget,
    run_with_budget,
)
from slicing import (
    SLICES_PLAN_FILENAME,
    build_slice_execution_prompt,
    build_slicing_plan_prompt,
    collect_prior_summaries,
    is_sliced,
    read_slices_plan,
    synthesize_final_summary,
)


# =============================================================================
# Внешний API
# =============================================================================

def run_agent(
    agent_id: str,
    project_id: str,
    input_artifacts: List[str],  # сохранён ради обратной совместимости с engine
    project_path: Optional[str] = None,
    state: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Запускает агента и возвращает результат выполнения.

    Если агент относится к sliced — выполняет двухфазный slicing-цикл.
    Иначе — обычный одиночный запуск.
    """
    started_at = datetime.now(timezone.utc).isoformat()

    try:
        if is_sliced(agent_id):
            artifacts = _run_sliced(agent_id, project_id, project_path, state)
        else:
            artifacts = _run_single(agent_id, project_id, project_path, state)

        return {
            "status": "completed",
            "artifacts": artifacts,
            "error": None,
            "started_at": started_at,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        return {
            "status": "failed",
            "artifacts": [],
            "error": f"{type(e).__name__}: {e}",
            "started_at": started_at,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }


def get_input_artifacts_for_agent(
    agent_id: str,
    state: Dict[str, Any],
) -> List[str]:
    """Совместимость с engine.py: список рассчитывается заново внутри run_agent.

    Возвращаем плоский список всех артефактов завершённых зависимостей —
    это используется только для хранения в state, фактический контекст
    собирается через collect_input_context внутри _build_full_prompt.
    """
    graph = state.get("pipeline_graph", {})
    agents_state = state.get("agents", {})

    artifacts: List[str] = []
    for edge in graph.get("edges", []):
        if edge[1] != agent_id:
            continue
        dep_state = agents_state.get(edge[0], {})
        if dep_state.get("status") != "completed":
            continue
        artifacts.extend(dep_state.get("artifacts", []))
    return artifacts


# =============================================================================
# Одиночный запуск
# =============================================================================

def _run_single(
    agent_id: str,
    project_id: str,
    project_path: Optional[str],
    state: Optional[Dict[str, Any]],
) -> List[str]:
    """Обычный (не-sliced) запуск: один вызов Claude Code."""
    output_dir = _ensure_output_dir(project_id, agent_id)
    system_prompt = _load_system_prompt(agent_id)
    task_prompt = _build_task_prompt(
        agent_id=agent_id,
        project_id=project_id,
        output_dir=output_dir,
        project_path=project_path,
        state=state,
        extra_instruction=build_summary_instruction(agent_id, str(output_dir)),
    )

    _execute(
        agent_id=agent_id,
        system_prompt=system_prompt,
        task_prompt=task_prompt,
        working_dir=output_dir,
        log_name="run.log",
    )

    artifacts = _collect_output_artifacts(output_dir, project_id)
    ensure_summary_exists(output_dir, agent_id, artifacts)
    return _collect_output_artifacts(output_dir, project_id)


# =============================================================================
# Sliced запуск
# =============================================================================

def _run_sliced(
    agent_id: str,
    project_id: str,
    project_path: Optional[str],
    state: Optional[Dict[str, Any]],
) -> List[str]:
    """Двухфазный запуск: план slices → выполнение каждого slice отдельно."""
    output_dir = _ensure_output_dir(project_id, agent_id)
    system_prompt = _load_system_prompt(agent_id)

    # --- Фаза 1: декомпозиция ---
    plan_prompt = _build_task_prompt(
        agent_id=agent_id,
        project_id=project_id,
        output_dir=output_dir,
        project_path=project_path,
        state=state,
        extra_instruction=build_slicing_plan_prompt(agent_id, str(output_dir)),
    )

    _execute(
        agent_id=agent_id,
        system_prompt=system_prompt,
        task_prompt=plan_prompt,
        working_dir=output_dir,
        log_name="slicing_plan.log",
    )

    slices = read_slices_plan(output_dir)
    if slices is None:
        # Fallback: агент не построил план → выполняем как обычный
        task_prompt = _build_task_prompt(
            agent_id=agent_id,
            project_id=project_id,
            output_dir=output_dir,
            project_path=project_path,
            state=state,
            extra_instruction=build_summary_instruction(agent_id, str(output_dir)),
        )
        _execute(
            agent_id=agent_id,
            system_prompt=system_prompt,
            task_prompt=task_prompt,
            working_dir=output_dir,
            log_name="run.log",
        )
        artifacts = _collect_output_artifacts(output_dir, project_id)
        ensure_summary_exists(output_dir, agent_id, artifacts)
        return artifacts

    # --- Фаза 2: исполнение slices последовательно ---
    base_context = _collect_base_context(agent_id, project_id, project_path, state)
    decisions_section = _decisions_section(project_id)

    for slice_def in slices:
        slice_prompt_body = build_slice_execution_prompt(
            agent_id=agent_id,
            slice_def=slice_def,
            output_dir=str(output_dir),
            prior_summaries=collect_prior_summaries(output_dir, slice_def["id"]),
        )

        full_task = (
            base_context
            + decisions_section
            + slice_prompt_body
            + build_decisions_instruction(project_id)
        )

        _execute(
            agent_id=agent_id,
            system_prompt=system_prompt,
            task_prompt=full_task,
            working_dir=output_dir,
            log_name=f"slice_{slice_def['id']}.log",
        )

    # --- Сводный SUMMARY.md ---
    synthesize_final_summary(output_dir, agent_id, slices)
    return _collect_output_artifacts(output_dir, project_id)


# =============================================================================
# Сборка промпта
# =============================================================================

def _load_system_prompt(agent_id: str) -> str:
    """Загружает system-prompt.md + rules.md как объединённый системный промпт."""
    agent_dir = get_agent_dir(agent_id)
    prompt_file = agent_dir / "system-prompt.md"
    rules_file = agent_dir / "rules.md"

    if not prompt_file.exists():
        raise FileNotFoundError(
            f"system-prompt.md не найден для агента {agent_id}: {prompt_file}"
        )

    parts = [prompt_file.read_text(encoding="utf-8")]
    if rules_file.exists():
        parts.append(f"\n\n# Правила\n\n{rules_file.read_text(encoding='utf-8')}")
    return "\n".join(parts)


def _collect_base_context(
    agent_id: str,
    project_id: str,
    project_path: Optional[str],
    state: Optional[Dict[str, Any]],
) -> str:
    """Контекст, общий для одиночного запуска и slicing-итераций."""
    parts: List[str] = []

    if state is not None:
        graph = state.get("pipeline_graph", {})
        ctx = collect_input_context(project_id, agent_id, state, graph)
        if ctx:
            parts.append(f"# Входные данные (summary зависимостей)\n\n{ctx}")

    if project_path:
        parts.append(
            f"\n\n# Директория проекта\n\n"
            f"Исходный код проекта: {project_path}\n"
            f"Читай код из ФС по необходимости. В промпте передан только "
            f"summary upstream-агентов и архитектурные решения."
        )
    return "\n".join(parts)


def _decisions_section(project_id: str) -> str:
    """Inject DECISIONS.md как отдельную секцию (если есть)."""
    decisions = read_decisions(project_id)
    if not decisions.strip():
        return ""
    return (
        f"\n\n# Архитектурные решения проекта (DECISIONS.md)\n\n"
        f"Это append-only журнал. Уважай уже принятые решения, "
        f"не противореч им без явной необходимости.\n\n"
        f"{decisions}\n"
    )


def _build_task_prompt(
    agent_id: str,
    project_id: str,
    output_dir: Path,
    project_path: Optional[str],
    state: Optional[Dict[str, Any]],
    extra_instruction: str,
) -> str:
    """Финальный пользовательский промпт (без системной части — она в --append-system-prompt)."""
    parts: List[str] = [_collect_base_context(agent_id, project_id, project_path, state)]
    parts.append(_decisions_section(project_id))
    parts.append(
        f"\n\n# Куда сохранять артефакты\n\n"
        f"Все выходные файлы — в `{output_dir}/`. Формат: Markdown."
    )
    parts.append(build_decisions_instruction(project_id))
    parts.append(extra_instruction)
    return "\n".join(p for p in parts if p)


# =============================================================================
# Запуск Claude Code
# =============================================================================

RATE_LIMIT_MAX_WAIT_SECONDS = 8 * 3600   # сколько максимум ждём сброса лимита (5h limit + запас)
RATE_LIMIT_BUFFER_SECONDS = 60           # запас сверху от resetsAt
RATE_LIMIT_MAX_RETRIES = 3               # сколько раз ждём + перезапускаем

AUTH_ERROR_BACKOFF = [60, 180, 600]      # секунды задержки между попытками при транзиентном 401


def _execute(
    agent_id: str,
    system_prompt: str,
    task_prompt: str,
    working_dir: Path,
    log_name: str,
) -> None:
    """Запускает claude --print с per-agent budget, stuck-detector и rate-limit retry."""
    import time as _time
    env = {**os.environ, **_load_env_vars()}
    budget = get_budget(agent_id)
    log_file = working_dir / log_name

    # stream-json + include-partial-messages даёт построчные события,
    # без них --print буферизует вывод и stuck-detector ложно срабатывает.
    cmd = [
        "claude",
        "--print",
        "--output-format", "stream-json",
        "--include-partial-messages",
        "--verbose",
        "--dangerously-skip-permissions",
        "--append-system-prompt",
        system_prompt,
        task_prompt,
    ]

    rate_retries = 0
    auth_retries = 0
    while True:
        try:
            run_with_budget(cmd, working_dir, env, budget, log_file=log_file)
            return
        except FileNotFoundError:
            raise RuntimeError(
                "Claude Code CLI не найден. Убедитесь, что 'claude' доступен в PATH."
            )
        except (AgentTimeout, AgentStuck) as e:
            raise RuntimeError(str(e))
        except AgentAuthError as ae:
            if auth_retries >= len(AUTH_ERROR_BACKOFF):
                raise RuntimeError(
                    f"401 сохраняется после {len(AUTH_ERROR_BACKOFF)} попыток. "
                    f"Проверь авторизацию (`claude login`). {ae}"
                )
            wait = AUTH_ERROR_BACKOFF[auth_retries]
            auth_retries += 1
            _log_auth_wait(log_file, agent_id, wait, auth_retries)
            _time.sleep(wait)
            continue
        except AgentRateLimited as rl:
            rate_retries += 1
            if rate_retries > RATE_LIMIT_MAX_RETRIES:
                raise RuntimeError(
                    f"Rate limit сохраняется после {RATE_LIMIT_MAX_RETRIES} попыток ожидания: {rl}"
                )
            wait_seconds = max(0, rl.resets_at - int(_time.time())) + RATE_LIMIT_BUFFER_SECONDS
            if wait_seconds > RATE_LIMIT_MAX_WAIT_SECONDS:
                raise RuntimeError(
                    f"Rate limit сбрасывается через {wait_seconds}s — больше лимита "
                    f"{RATE_LIMIT_MAX_WAIT_SECONDS}s. Не ждём: {rl}"
                )
            _log_rate_limit_wait(log_file, agent_id, rl, wait_seconds, rate_retries)
            _time.sleep(wait_seconds)
            # while-loop повторит run_with_budget


def _log_auth_wait(log_file: Path, agent_id: str, wait_seconds: int, attempt: int) -> None:
    """Лог ожидания после транзиентного 401."""
    import time as _time
    msg = (
        f"\n=== AUTH 401 @ {_time.strftime('%Y-%m-%dT%H:%M:%S')} "
        f"agent={agent_id} attempt={attempt} sleep={wait_seconds}s ===\n"
    )
    print(msg, flush=True)
    try:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        with log_file.open("a", encoding="utf-8") as f:
            f.write(msg)
    except OSError:
        pass


def _log_rate_limit_wait(log_file: Path, agent_id: str, rl: "AgentRateLimited",
                          wait_seconds: int, attempt: int) -> None:
    """Записывает в лог ожидание сброса rate limit (видно и оператору, и в дашборде через run.log)."""
    import time as _time
    msg = (
        f"\n=== RATE LIMIT @ {_time.strftime('%Y-%m-%dT%H:%M:%S')} "
        f"agent={agent_id} attempt={attempt} kind={rl.kind} "
        f"resets_at={_time.strftime('%Y-%m-%dT%H:%M:%S', _time.localtime(rl.resets_at))} "
        f"sleep={wait_seconds}s ===\n"
    )
    print(msg, flush=True)
    try:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        with log_file.open("a", encoding="utf-8") as f:
            f.write(msg)
    except OSError:
        pass


def _load_env_vars() -> Dict[str, str]:
    """Загружает переменные окружения из orchestrator/.env."""
    env_file = Path(__file__).parent / ".env"
    extra_env: Dict[str, str] = {}
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if key and value:
                extra_env[key] = value
    return extra_env


# =============================================================================
# Вспомогательное
# =============================================================================

def _ensure_output_dir(project_id: str, agent_id: str) -> Path:
    phase = get_agent_phase(agent_id)
    output_dir = PROJECTS_DIR / project_id / phase / agent_id
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def _collect_output_artifacts(output_dir: Path, project_id: str) -> List[str]:
    """Собирает .md-артефакты + slices.json из директории агента."""
    project_dir = PROJECTS_DIR / project_id
    artifacts: List[str] = []

    if not output_dir.exists():
        return artifacts

    for file_path in output_dir.rglob("*.md"):
        artifacts.append(str(file_path.relative_to(project_dir)))
    # Все .json — конфиги (pipeline-graph.json, slices.json, decisions.json и т.п.)
    for file_path in output_dir.rglob("*.json"):
        artifacts.append(str(file_path.relative_to(project_dir)))

    return artifacts
