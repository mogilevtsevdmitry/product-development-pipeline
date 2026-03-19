"""
DAG-executor и state machine Product Development Pipeline.

Главный модуль оркестратора: создание проектов, запуск пайплайна,
управление gate-точками, чтение и обновление состояния.
"""

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Any, Optional

from config import (
    PROJECTS_DIR,
    STATE_DIR,
    SCHEMA_VERSION,
    AGENT_REGISTRY,
    PIPELINE_MODES,
    get_agent_phase,
)
from gates import check_gate, is_gate_resolved, validate_gate_decision, GATES
from pipeline_builder import STATIC_CHAIN, get_agent_dependencies
from agent_runner import run_agent, get_input_artifacts_for_agent


# =============================================================================
# Создание проекта
# =============================================================================

def create_project(
    name: str,
    description: str,
    mode: str = "auto",
) -> Dict[str, Any]:
    """
    Создаёт новый проект в пайплайне.

    Инициализирует JSON-состояние с начальным графом (статическая цепочка),
    создаёт директорию проекта для артефактов.

    Args:
        name: Название проекта.
        description: Описание идеи/продукта.
        mode: Режим работы — "auto" или "human_approval".

    Returns:
        Начальное состояние проекта.

    Raises:
        ValueError: Если режим не допустим.
    """
    if mode not in PIPELINE_MODES:
        raise ValueError(
            f"Недопустимый режим: {mode}. Допустимые: {PIPELINE_MODES}"
        )

    # Генерируем project_id из имени
    project_id = _slugify(name)
    timestamp = datetime.now(timezone.utc).isoformat()

    # Начальный граф — только статическая цепочка
    initial_graph = {
        "nodes": list(STATIC_CHAIN),
        "edges": [
            ["problem-researcher", "market-researcher"],
            ["market-researcher", "product-owner"],
        ],
        "parallel_groups": [],
    }

    # Начальное состояние агентов
    agents_state: Dict[str, Any] = {}
    for agent_id in STATIC_CHAIN:
        agents_state[agent_id] = {
            "status": "pending",
            "started_at": None,
            "completed_at": None,
            "artifacts": [],
            "error": None,
        }

    state: Dict[str, Any] = {
        "project_id": project_id,
        "name": name,
        "description": description,
        "created_at": timestamp,
        "updated_at": timestamp,
        "mode": mode,
        "status": "running",
        "current_gate": None,
        "pipeline_graph": initial_graph,
        "agents": agents_state,
        "gate_decisions": {},
        "schema_version": SCHEMA_VERSION,
    }

    # Создаём директории
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    (PROJECTS_DIR / project_id).mkdir(parents=True, exist_ok=True)

    # Сохраняем состояние
    _save_state(state)

    return state


# =============================================================================
# Основной цикл пайплайна
# =============================================================================

def run_pipeline(project_id: str) -> Dict[str, Any]:
    """
    Главный цикл выполнения пайплайна.

    Последовательность:
    1. Загружает состояние
    2. Находит готовых агентов (все зависимости completed)
    3. Проверяет gate-точки → пауза если нужно
    4. Запускает готовых агентов
    5. Обновляет состояние
    6. При ошибке: retry один раз, затем fail
    7. Повторяет до завершения или ошибки

    Args:
        project_id: Идентификатор проекта.

    Returns:
        Финальное состояние проекта.

    Raises:
        FileNotFoundError: Если состояние проекта не найдено.
    """
    state = _load_state(project_id)

    if state["status"] in ("completed", "failed"):
        return state

    while True:
        state = _load_state(project_id)

        # Проверяем, не завершён ли пайплайн
        if _is_pipeline_complete(state):
            state["status"] = "completed"
            state["updated_at"] = datetime.now(timezone.utc).isoformat()
            _save_state(state)
            return state

        # Проверяем gate-точки
        gate = check_gate(state)
        if gate is not None:
            state["status"] = "paused_at_gate"
            state["current_gate"] = gate
            state["updated_at"] = datetime.now(timezone.utc).isoformat()
            _save_state(state)
            return state

        # Находим готовых агентов
        ready_agents = _find_ready_agents(state)

        if not ready_agents:
            # Если есть running агенты — ждём
            running = [
                aid for aid, a in state["agents"].items()
                if a["status"] == "running"
            ]
            if running:
                time.sleep(2)
                continue
            # Нет ни ready, ни running — тупик или всё завершено
            if _is_pipeline_complete(state):
                state["status"] = "completed"
            else:
                state["status"] = "failed"
                state["agents"].setdefault("_pipeline", {})["error"] = (
                    "Тупик: нет готовых и нет запущенных агентов"
                )
            state["updated_at"] = datetime.now(timezone.utc).isoformat()
            _save_state(state)
            return state

        # В режиме human_approval ставим на паузу после каждого агента
        if state["mode"] == "human_approval":
            # Запускаем по одному агенту, затем пауза
            agent_id = ready_agents[0]
            state = _run_single_agent(state, agent_id)
            _save_state(state)

            if state["status"] == "failed":
                return state

            # Пауза для подтверждения (если не на gate-точке)
            if check_gate(state) is None and not _is_pipeline_complete(state):
                state["status"] = "paused_at_gate"
                state["current_gate"] = f"approval_{agent_id}"
                state["updated_at"] = datetime.now(timezone.utc).isoformat()
                _save_state(state)
                return state
        else:
            # Auto-режим: запускаем всех готовых
            for agent_id in ready_agents:
                state = _run_single_agent(state, agent_id)
                _save_state(state)

                if state["status"] == "failed":
                    return state


def _run_single_agent(
    state: Dict[str, Any],
    agent_id: str,
) -> Dict[str, Any]:
    """
    Запускает одного агента с retry-логикой.

    Args:
        state: Текущее состояние проекта.
        agent_id: Идентификатор агента.

    Returns:
        Обновлённое состояние.
    """
    project_id = state["project_id"]

    # Помечаем агента как running
    state["agents"][agent_id]["status"] = "running"
    state["agents"][agent_id]["started_at"] = (
        datetime.now(timezone.utc).isoformat()
    )
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_state(state)

    # Собираем входные артефакты
    input_artifacts = get_input_artifacts_for_agent(agent_id, state)

    # Первая попытка
    result = run_agent(agent_id, project_id, input_artifacts)

    if result["status"] == "failed":
        # Retry: одна повторная попытка
        result = run_agent(agent_id, project_id, input_artifacts)

    # Обновляем состояние агента
    state["agents"][agent_id]["status"] = result["status"]
    state["agents"][agent_id]["completed_at"] = result.get("completed_at")
    state["agents"][agent_id]["artifacts"] = result.get("artifacts", [])
    state["agents"][agent_id]["error"] = result.get("error")

    if result["status"] == "failed":
        state["status"] = "failed"

    state["updated_at"] = datetime.now(timezone.utc).isoformat()

    # Если это pipeline-architect и он завершился — расширяем граф
    if agent_id == "pipeline-architect" and result["status"] == "completed":
        state = _expand_pipeline_graph(state)

    return state


# =============================================================================
# Gate-решения
# =============================================================================

def resolve_gate(
    project_id: str,
    gate_name: str,
    decision: str,
    notes: str = "",
) -> Dict[str, Any]:
    """
    Записывает решение по gate-точке и возобновляет пайплайн.

    Args:
        project_id: Идентификатор проекта.
        gate_name: Имя gate-точки.
        decision: Принятое решение (зависит от gate).
        notes: Комментарий к решению.

    Returns:
        Обновлённое состояние проекта.

    Raises:
        ValueError: Если решение недопустимо.
    """
    validate_gate_decision(gate_name, decision)
    state = _load_state(project_id)

    timestamp = datetime.now(timezone.utc).isoformat()

    state["gate_decisions"][gate_name] = {
        "decision": decision,
        "decided_by": "human",
        "timestamp": timestamp,
        "notes": notes,
    }

    # Обрабатываем решение
    if decision in ("stop", "no-go"):
        state["status"] = "failed"
        state["current_gate"] = None
    elif decision in ("pivot", "revise", "rollback"):
        # Сбрасываем нужных агентов для повторного прохода
        state = _handle_rework(state, gate_name, decision)
        state["status"] = "running"
        state["current_gate"] = None
    else:
        # go — продолжаем
        state["status"] = "running"
        state["current_gate"] = None

    state["updated_at"] = timestamp
    _save_state(state)

    return state


def _handle_rework(
    state: Dict[str, Any],
    gate_name: str,
    decision: str,
) -> Dict[str, Any]:
    """
    Обрабатывает решения pivot/revise/rollback — сбрасывает нужных агентов.

    Args:
        state: Текущее состояние.
        gate_name: Имя gate-точки.
        decision: Решение.

    Returns:
        Обновлённое состояние со сброшенными агентами.
    """
    gate_def = GATES[gate_name]
    after_agents = gate_def["after_agents"]

    # Удаляем решение gate чтобы можно было пройти заново
    if gate_name in state["gate_decisions"]:
        # Оставляем запись но помечаем как rework
        state["gate_decisions"][gate_name]["rework"] = True

    # Сбрасываем after_agents в pending для повторного прохождения
    for agent_id in after_agents:
        if agent_id in state["agents"]:
            state["agents"][agent_id]["status"] = "pending"
            state["agents"][agent_id]["started_at"] = None
            state["agents"][agent_id]["completed_at"] = None
            state["agents"][agent_id]["artifacts"] = []
            state["agents"][agent_id]["error"] = None

    return state


# =============================================================================
# Расширение графа после Pipeline Architect
# =============================================================================

def _expand_pipeline_graph(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    Расширяет граф пайплайна после завершения Pipeline Architect.

    Читает артефакт pipeline-architect и добавляет в граф
    динамические узлы и рёбра.

    Args:
        state: Текущее состояние.

    Returns:
        Состояние с расширенным графом.
    """
    from pipeline_builder import build_pipeline, DEFAULT_FULL_GRAPH

    # Пытаемся прочитать конфигурацию из артефакта pipeline-architect
    pa_artifacts = state["agents"].get("pipeline-architect", {}).get(
        "artifacts", []
    )
    project_dir = PROJECTS_DIR / state["project_id"]

    pipeline_config = None
    for artifact_path in pa_artifacts:
        full_path = project_dir / artifact_path
        if full_path.exists() and full_path.suffix == ".json":
            try:
                pipeline_config = json.loads(
                    full_path.read_text(encoding="utf-8")
                )
                break
            except json.JSONDecodeError:
                continue

    if pipeline_config and "nodes" in pipeline_config:
        # Pipeline Architect создал конфигурацию
        new_graph = pipeline_config
    else:
        # Используем полный граф по умолчанию
        new_graph = DEFAULT_FULL_GRAPH

    # Обновляем граф в состоянии
    state["pipeline_graph"] = new_graph

    # Добавляем состояние для новых агентов
    for node in new_graph["nodes"]:
        if node not in state["agents"]:
            state["agents"][node] = {
                "status": "pending",
                "started_at": None,
                "completed_at": None,
                "artifacts": [],
                "error": None,
            }

    return state


# =============================================================================
# Чтение и управление состоянием
# =============================================================================

def get_state(project_id: str) -> Dict[str, Any]:
    """
    Возвращает текущее состояние проекта.

    Args:
        project_id: Идентификатор проекта.

    Returns:
        Состояние проекта (JSON dict).

    Raises:
        FileNotFoundError: Если проект не найден.
    """
    return _load_state(project_id)


def list_projects() -> List[Dict[str, Any]]:
    """
    Возвращает список всех проектов с их состояниями.

    Returns:
        Список состояний проектов (краткая информация).
    """
    projects: List[Dict[str, Any]] = []

    if not STATE_DIR.exists():
        return projects

    for state_file in STATE_DIR.glob("*.json"):
        try:
            state = json.loads(state_file.read_text(encoding="utf-8"))
            projects.append({
                "project_id": state.get("project_id"),
                "name": state.get("name"),
                "status": state.get("status"),
                "mode": state.get("mode"),
                "current_gate": state.get("current_gate"),
                "created_at": state.get("created_at"),
                "updated_at": state.get("updated_at"),
            })
        except (json.JSONDecodeError, KeyError):
            continue

    return sorted(projects, key=lambda p: p.get("created_at", ""), reverse=True)


def switch_mode(project_id: str, mode: str) -> Dict[str, Any]:
    """
    Переключает режим работы пайплайна.

    Args:
        project_id: Идентификатор проекта.
        mode: Новый режим — "auto" или "human_approval".

    Returns:
        Обновлённое состояние.

    Raises:
        ValueError: Если режим не допустим.
    """
    if mode not in PIPELINE_MODES:
        raise ValueError(
            f"Недопустимый режим: {mode}. Допустимые: {PIPELINE_MODES}"
        )

    state = _load_state(project_id)
    state["mode"] = mode
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_state(state)

    return state


# =============================================================================
# Вспомогательные функции
# =============================================================================

def _find_ready_agents(state: Dict[str, Any]) -> List[str]:
    """
    Находит агентов, готовых к запуску.

    Агент готов если:
    - Его статус — pending
    - Все его зависимости (входящие рёбра) имеют статус completed

    Args:
        state: Текущее состояние проекта.

    Returns:
        Список ID готовых агентов.
    """
    graph = state.get("pipeline_graph", {})
    agents_state = state.get("agents", {})
    ready: List[str] = []

    for node in graph.get("nodes", []):
        agent = agents_state.get(node, {})

        if agent.get("status") != "pending":
            continue

        # Проверяем все зависимости
        deps = get_agent_dependencies(graph, node)
        all_deps_completed = all(
            agents_state.get(dep, {}).get("status") == "completed"
            for dep in deps
        )

        if all_deps_completed:
            ready.append(node)

    return ready


def _is_pipeline_complete(state: Dict[str, Any]) -> bool:
    """
    Проверяет, завершён ли пайплайн.

    Пайплайн завершён когда все агенты в графе имеют статус
    completed или skipped.

    Args:
        state: Текущее состояние проекта.

    Returns:
        True если пайплайн завершён.
    """
    graph = state.get("pipeline_graph", {})
    agents_state = state.get("agents", {})

    for node in graph.get("nodes", []):
        status = agents_state.get(node, {}).get("status", "pending")
        if status not in ("completed", "skipped"):
            return False

    return True


def _load_state(project_id: str) -> Dict[str, Any]:
    """
    Загружает состояние проекта из JSON файла.

    Args:
        project_id: Идентификатор проекта.

    Returns:
        Состояние проекта.

    Raises:
        FileNotFoundError: Если файл состояния не найден.
    """
    state_file = STATE_DIR / f"{project_id}.json"

    if not state_file.exists():
        raise FileNotFoundError(
            f"Состояние проекта не найдено: {state_file}"
        )

    return json.loads(state_file.read_text(encoding="utf-8"))


def _save_state(state: Dict[str, Any]) -> None:
    """
    Сохраняет состояние проекта в JSON файл.

    Args:
        state: Состояние проекта для сохранения.
    """
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    state_file = STATE_DIR / f"{state['project_id']}.json"
    state_file.write_text(
        json.dumps(state, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _slugify(name: str) -> str:
    """
    Преобразует название проекта в URL-safe идентификатор.

    Args:
        name: Название проекта.

    Returns:
        Slug-идентификатор.
    """
    import re
    import unicodedata

    # Транслитерация кириллицы
    slug = unicodedata.normalize("NFKD", name)
    slug = slug.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[-\s]+", "-", slug)
    slug = slug.strip("-")

    if not slug:
        slug = f"project-{int(time.time())}"

    return slug
