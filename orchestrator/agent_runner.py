"""
Запуск агентов пайплайна.

Каждый агент получает system-prompt.md + rules.md + входные артефакты
от завершённых зависимостей. Результаты сохраняются в
projects/{project_id}/{phase}/{agent_id}/.
"""

import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Any, Optional

from config import (
    BASE_DIR,
    PROJECTS_DIR,
    get_agent_dir,
    get_agent_phase,
)


def _load_env_vars() -> Dict[str, str]:
    """Load environment variables from orchestrator/.env file."""
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
            if value and key:
                extra_env[key] = value
    return extra_env


def run_agent(
    agent_id: str,
    project_id: str,
    input_artifacts: List[str],
    project_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Запускает агента и возвращает результат выполнения.

    Последовательность:
    1. Загружает system-prompt.md и rules.md из директории агента
    2. Читает входные артефакты из projects/{project_id}/
    3. Формирует промпт с контекстом
    4. Запускает агента через Claude Code CLI (subprocess)
    5. Сохраняет выходные артефакты в projects/{project_id}/{phase}/{agent_id}/
    6. Возвращает статус выполнения

    Args:
        agent_id: Идентификатор агента из реестра.
        project_id: Идентификатор проекта.
        input_artifacts: Список путей к входным артефактам (относительно projects/).
        project_path: Путь к директории проекта (для чтения кода из ФС).

    Returns:
        Словарь с результатом:
        {
            "status": "completed" | "failed",
            "artifacts": ["relative/path.md", ...],
            "error": "string | null",
            "started_at": "ISO 8601",
            "completed_at": "ISO 8601"
        }
    """
    started_at = datetime.now(timezone.utc).isoformat()

    try:
        # Загружаем промпты агента
        system_prompt = _load_agent_prompt(agent_id)
        rules = _load_agent_rules(agent_id)

        # Читаем входные артефакты
        context = _collect_input_context(project_id, input_artifacts)

        # Подготавливаем выходную директорию
        phase = get_agent_phase(agent_id)
        output_dir = _ensure_output_dir(project_id, phase, agent_id)

        # Формируем полный промпт
        full_prompt = _build_full_prompt(
            agent_id=agent_id,
            system_prompt=system_prompt,
            rules=rules,
            context=context,
            output_dir=str(output_dir),
            project_path=project_path,
        )

        # Запускаем агента через Claude Code
        result = _execute_agent(full_prompt, output_dir)

        # Собираем выходные артефакты
        artifacts = _collect_output_artifacts(output_dir, project_id)

        completed_at = datetime.now(timezone.utc).isoformat()

        return {
            "status": "completed",
            "artifacts": artifacts,
            "error": None,
            "started_at": started_at,
            "completed_at": completed_at,
        }

    except Exception as e:
        completed_at = datetime.now(timezone.utc).isoformat()
        return {
            "status": "failed",
            "artifacts": [],
            "error": str(e),
            "started_at": started_at,
            "completed_at": completed_at,
        }


def _load_agent_prompt(agent_id: str) -> str:
    """
    Загружает system-prompt.md агента.

    Args:
        agent_id: Идентификатор агента.

    Returns:
        Содержимое system-prompt.md.

    Raises:
        FileNotFoundError: Если файл не найден.
    """
    agent_dir = get_agent_dir(agent_id)
    prompt_file = agent_dir / "system-prompt.md"

    if not prompt_file.exists():
        raise FileNotFoundError(
            f"system-prompt.md не найден для агента {agent_id}: {prompt_file}"
        )

    return prompt_file.read_text(encoding="utf-8")


def _load_agent_rules(agent_id: str) -> str:
    """
    Загружает rules.md агента. Возвращает пустую строку если файл отсутствует.

    Args:
        agent_id: Идентификатор агента.

    Returns:
        Содержимое rules.md или пустая строка.
    """
    agent_dir = get_agent_dir(agent_id)
    rules_file = agent_dir / "rules.md"

    if not rules_file.exists():
        return ""

    return rules_file.read_text(encoding="utf-8")


def _collect_input_context(
    project_id: str,
    input_artifacts: List[str],
) -> str:
    """
    Собирает контекст из входных артефактов.

    Args:
        project_id: Идентификатор проекта.
        input_artifacts: Список относительных путей к артефактам.

    Returns:
        Объединённое содержимое артефактов с заголовками.
    """
    if not input_artifacts:
        return ""

    parts: List[str] = []
    project_dir = PROJECTS_DIR / project_id

    for artifact_path in input_artifacts:
        full_path = project_dir / artifact_path
        if full_path.exists():
            content = full_path.read_text(encoding="utf-8")
            parts.append(
                f"--- Артефакт: {artifact_path} ---\n{content}\n"
            )

    return "\n".join(parts)


def _ensure_output_dir(
    project_id: str,
    phase: str,
    agent_id: str,
) -> Path:
    """
    Создаёт директорию для выходных артефактов агента.

    Args:
        project_id: Идентификатор проекта.
        phase: Фаза пайплайна.
        agent_id: Идентификатор агента.

    Returns:
        Путь к созданной директории.
    """
    output_dir = PROJECTS_DIR / project_id / phase / agent_id
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def _build_full_prompt(
    agent_id: str,
    system_prompt: str,
    rules: str,
    context: str,
    output_dir: str,
    project_path: Optional[str] = None,
) -> str:
    """
    Формирует полный промпт для агента.

    Args:
        agent_id: Идентификатор агента.
        system_prompt: Содержимое system-prompt.md.
        rules: Содержимое rules.md.
        context: Контекст из входных артефактов.
        output_dir: Путь для сохранения результатов.
        project_path: Путь к директории проекта (для чтения кода из ФС).

    Returns:
        Полный промпт.
    """
    parts: List[str] = [system_prompt]

    if rules:
        parts.append(f"\n\n# Правила\n\n{rules}")

    if context:
        parts.append(f"\n\n# Входные данные\n\n{context}")

    if project_path:
        parts.append(
            f"\n\n# Директория проекта\n\n"
            f"Исходный код проекта находится в: {project_path}\n"
            f"Читай код из файловой системы по необходимости. "
            f"В промпте передана только документация (контракты, требования, архитектура)."
        )

    parts.append(
        f"\n\n# Инструкции по сохранению\n\n"
        f"Сохрани все выходные артефакты в директорию: {output_dir}\n"
        f"Формат: Markdown (.md файлы)."
    )

    return "\n".join(parts)


def _execute_agent(prompt: str, working_dir: Path) -> str:
    """
    Запускает агента через Claude Code CLI как субпроцесс.

    Args:
        prompt: Полный промпт для агента.
        working_dir: Рабочая директория агента.

    Returns:
        Вывод Claude Code.

    Raises:
        RuntimeError: Если выполнение завершилось с ошибкой.
    """
    try:
        env = {**os.environ, **_load_env_vars()}
        result = subprocess.run(
            [
                "claude",
                "--print",
                "--dangerously-skip-permissions",
                prompt,
            ],
            cwd=str(working_dir),
            capture_output=True,
            text=True,
            timeout=600,  # 10 минут на агента
            env=env,
        )

        if result.returncode != 0:
            error_msg = result.stderr.strip() or result.stdout.strip()
            raise RuntimeError(
                f"Claude Code завершился с ошибкой (код {result.returncode}): "
                f"{error_msg}"
            )

        return result.stdout

    except subprocess.TimeoutExpired:
        raise RuntimeError("Таймаут выполнения агента (10 минут)")
    except FileNotFoundError:
        raise RuntimeError(
            "Claude Code CLI не найден. Убедитесь, что 'claude' доступен в PATH."
        )


def _collect_output_artifacts(
    output_dir: Path,
    project_id: str,
) -> List[str]:
    """
    Собирает список выходных артефактов из директории агента.

    Args:
        output_dir: Директория с результатами агента.
        project_id: Идентификатор проекта.

    Returns:
        Список относительных путей к артефактам (от projects/{project_id}/).
    """
    project_dir = PROJECTS_DIR / project_id
    artifacts: List[str] = []

    if output_dir.exists():
        for file_path in output_dir.rglob("*.md"):
            relative = file_path.relative_to(project_dir)
            artifacts.append(str(relative))

    return artifacts


def get_input_artifacts_for_agent(
    agent_id: str,
    state: Dict[str, Any],
) -> List[str]:
    """
    Определяет входные артефакты для агента на основе состояния пайплайна.

    Собирает артефакты от завершённых зависимостей с учётом фильтров.
    Фильтры задаются третьим элементом в edge:
    - ["a", "b"] — все артефакты (обратная совместимость)
    - ["a", "b", ["file.md"]] — только указанные файлы
    - ["a", "b", []] — ничего не передавать

    Args:
        agent_id: Идентификатор агента.
        state: Текущее состояние проекта.

    Returns:
        Список путей к артефактам зависимостей.
    """
    graph = state.get("pipeline_graph", {})
    agents_state = state.get("agents", {})

    artifacts: List[str] = []
    for edge in graph.get("edges", []):
        if edge[1] != agent_id:
            continue

        dep_id = edge[0]
        dep_state = agents_state.get(dep_id, {})
        if dep_state.get("status") != "completed":
            continue

        dep_artifacts = dep_state.get("artifacts", [])

        # Фильтрация: если есть третий элемент в edge
        if len(edge) > 2:
            allowed = edge[2]
            if not allowed:
                # Пустой список — ничего не передаём
                continue
            # Фильтруем по имени файла
            dep_artifacts = [
                a for a in dep_artifacts
                if any(a.endswith(f) for f in allowed)
            ]

        artifacts.extend(dep_artifacts)

    return artifacts
