"""
Логика human gate-точек пайплайна.

Три gate-точки обеспечивают контроль человека на ключевых решениях:
- Gate 1 (Строим?) — после Product Owner, перед Pipeline Architect
- Gate 2 (Архитектура) — после System Architect + UX/UI Designer, перед Tech Lead
- Gate 3 (Go/No-go) — после QA + Security + DevOps, перед Release Manager
"""

from typing import Optional, Dict, Any, List

from config import GATES


def check_gate(state: Dict[str, Any]) -> Optional[str]:
    """
    Проверяет, находится ли пайплайн на gate-точке.

    Gate активируется когда:
    - Все after_agents завершены (completed)
    - Хотя бы один before_agent ещё в pending
    - Gate ещё не разрешён (нет решения в gate_decisions)
    - Все after_agents и before_agents присутствуют в графе пайплайна

    Args:
        state: Текущее состояние проекта (JSON dict).

    Returns:
        Имя gate-точки если пайплайн на ней, иначе None.
    """
    agents_state: Dict[str, Any] = state.get("agents", {})
    gate_decisions: Dict[str, Any] = state.get("gate_decisions", {})
    pipeline_nodes: List[str] = state.get("pipeline_graph", {}).get("nodes", [])

    for gate_name, gate_def in GATES.items():
        after_agents: List[str] = gate_def["after_agents"]
        before_agents: List[str] = gate_def["before_agents"]

        # Gate срабатывает если в графе есть хоть один after_agent.
        # Раньше требовалось наличие before_agents — но Pipeline Architect
        # может убрать ненужного агента (например release-manager для MVP-бота),
        # и тогда gate тихо терялся, пропуская QA-вердикт.
        after_in_graph = any(a in pipeline_nodes for a in after_agents)
        if not after_in_graph:
            continue

        # Все after_agents, присутствующие в графе, должны быть completed
        after_in_graph_list = [a for a in after_agents if a in pipeline_nodes]
        all_after_completed = all(
            agents_state.get(agent_id, {}).get("status") == "completed"
            for agent_id in after_in_graph_list
        )

        # Если before_agents в графе есть — хотя бы один должен быть pending.
        # Если их нет (PA выбросил) — gate всё равно нужно сработать
        # как post-checkpoint после соответствующих after_agents.
        before_in_graph_list = [a for a in before_agents if a in pipeline_nodes]
        if before_in_graph_list:
            any_before_pending = any(
                agents_state.get(agent_id, {}).get("status") == "pending"
                for agent_id in before_in_graph_list
            )
        else:
            any_before_pending = True  # post-checkpoint режим

        # Gate ещё не разрешён
        not_resolved = not is_gate_resolved(state, gate_name)

        if all_after_completed and any_before_pending and not_resolved:
            return gate_name

    return None


def is_gate_resolved(state: Dict[str, Any], gate_name: str) -> bool:
    """
    Проверяет, было ли принято решение по gate-точке.

    Args:
        state: Текущее состояние проекта.
        gate_name: Имя gate-точки.

    Returns:
        True если решение принято, False иначе.
    """
    gate_decisions: Dict[str, Any] = state.get("gate_decisions", {})
    decision_record = gate_decisions.get(gate_name)

    if decision_record is None:
        return False

    return decision_record.get("decision") is not None


def get_gate_info(gate_name: str) -> Dict[str, Any]:
    """
    Возвращает информацию о gate-точке.

    Args:
        gate_name: Имя gate-точки.

    Returns:
        Словарь с определением gate-точки.

    Raises:
        ValueError: Если gate-точка не найдена.
    """
    if gate_name not in GATES:
        raise ValueError(f"Неизвестная gate-точка: {gate_name}")
    return GATES[gate_name]


def validate_gate_decision(gate_name: str, decision: str) -> bool:
    """
    Проверяет допустимость решения для gate-точки.

    Args:
        gate_name: Имя gate-точки.
        decision: Принятое решение.

    Returns:
        True если решение допустимо.

    Raises:
        ValueError: Если gate-точка не найдена или решение недопустимо.
    """
    if gate_name not in GATES:
        raise ValueError(f"Неизвестная gate-точка: {gate_name}")

    allowed = GATES[gate_name]["decisions"]
    if decision not in allowed:
        raise ValueError(
            f"Недопустимое решение '{decision}' для {gate_name}. "
            f"Допустимые: {allowed}"
        )
    return True


def get_pending_gates(state: Dict[str, Any]) -> List[str]:
    """
    Возвращает список gate-точек, ожидающих решения.

    Args:
        state: Текущее состояние проекта.

    Returns:
        Список имён gate-точек без решения, чьи after_agents завершены.
    """
    pending: List[str] = []
    agents_state = state.get("agents", {})
    pipeline_nodes = state.get("pipeline_graph", {}).get("nodes", [])

    for gate_name, gate_def in GATES.items():
        after_agents = gate_def["after_agents"]

        # Проверяем наличие в графе
        if not all(a in pipeline_nodes for a in after_agents):
            continue

        # Все after_agents завершены
        all_completed = all(
            agents_state.get(a, {}).get("status") == "completed"
            for a in after_agents
        )

        if all_completed and not is_gate_resolved(state, gate_name):
            pending.append(gate_name)

    return pending
