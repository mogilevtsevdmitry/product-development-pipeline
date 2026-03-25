"""
Конфигурация Product Development Pipeline.

Константы, пути, реестр агентов, определения фаз и gate-точек.
"""

from pathlib import Path
from typing import Dict, List, Any

# =============================================================================
# Пути
# =============================================================================

BASE_DIR: Path = Path(__file__).resolve().parent.parent
AGENTS_DIR: Path = BASE_DIR / "agents"
PROJECTS_DIR: Path = BASE_DIR / "projects"
STATE_DIR: Path = Path(__file__).resolve().parent / "state"
DASHBOARD_DIR: Path = BASE_DIR / "dashboard"

# Версия схемы состояния
SCHEMA_VERSION: int = 2

# =============================================================================
# Реестр агентов
# =============================================================================

AGENT_REGISTRY: Dict[str, str] = {
    # Мета-агенты
    "pipeline-architect": "agents/meta/pipeline-architect",
    "orchestrator":       "agents/meta/orchestrator",

    # Исследование
    "problem-researcher": "agents/research/problem-researcher",
    "market-researcher":  "agents/research/market-researcher",

    # Продукт
    "product-owner":      "agents/product/product-owner",
    "business-analyst":   "agents/product/business-analyst",

    # Юридическое
    "legal-compliance":   "agents/legal/legal-compliance",

    # Дизайн
    "ux-ui-designer":     "agents/design/ux-ui-designer",

    # Разработка
    "system-architect":   "agents/development/system-architect",
    "tech-lead":          "agents/development/tech-lead",
    "backend-developer":  "agents/development/backend-developer",
    "frontend-developer": "agents/development/frontend-developer",
    "devops-engineer":    "agents/development/devops-engineer",

    # Качество
    "qa-engineer":        "agents/quality/qa-engineer",
    "security-engineer":  "agents/quality/security-engineer",

    # Релиз
    "release-manager":    "agents/release/release-manager",

    # Маркетинг
    "product-marketer":   "agents/marketing/product-marketer",
    "smm-manager":        "agents/marketing/smm-manager",
    "content-creator":    "agents/marketing/content-creator",

    # Фидбек
    "customer-support":   "agents/feedback/customer-support",
    "data-analyst":       "agents/feedback/data-analyst",
}

# =============================================================================
# Определения фаз
# =============================================================================

PHASES: Dict[str, List[str]] = {
    "research": [
        "problem-researcher",
        "market-researcher",
    ],
    "product": [
        "product-owner",
        "business-analyst",
    ],
    "legal": [
        "legal-compliance",
    ],
    "design": [
        "ux-ui-designer",
    ],
    "development": [
        "system-architect",
        "tech-lead",
        "backend-developer",
        "frontend-developer",
        "devops-engineer",
    ],
    "quality": [
        "qa-engineer",
        "security-engineer",
    ],
    "release": [
        "release-manager",
    ],
    "marketing": [
        "product-marketer",
        "smm-manager",
        "content-creator",
    ],
    "feedback": [
        "customer-support",
        "data-analyst",
    ],
}


# =============================================================================
# Блоки по умолчанию для новых проектов
# =============================================================================

DEFAULT_BLOCKS: List[Dict[str, Any]] = [
    {
        "id": "research",
        "name": "Исследование",
        "description": "Анализ проблемы, исследование рынка, формирование продуктового видения",
        "agents": ["problem-researcher", "market-researcher", "product-owner", "business-analyst"],
        "edges": [
            ["problem-researcher", "market-researcher"],
            ["market-researcher", "product-owner"],
            ["product-owner", "business-analyst"],
        ],
        "depends_on": [],
        "requires_approval": True,
    },
    {
        "id": "legal",
        "name": "Юридическое",
        "description": "Проверка юридических и compliance требований",
        "agents": ["legal-compliance"],
        "edges": [],
        "depends_on": ["research"],
        "requires_approval": False,
    },
    {
        "id": "design",
        "name": "Дизайн",
        "description": "Проектирование пользовательского интерфейса и опыта",
        "agents": ["ux-ui-designer"],
        "edges": [],
        "depends_on": ["research"],
        "requires_approval": False,
    },
    {
        "id": "development",
        "name": "Архитектура и разработка",
        "description": "Проектирование архитектуры, планирование и реализация",
        "agents": ["pipeline-architect", "system-architect", "tech-lead", "backend-developer", "frontend-developer", "devops-engineer"],
        "edges": [
            ["pipeline-architect", "system-architect"],
            ["system-architect", "tech-lead"],
            ["tech-lead", "backend-developer"],
            ["tech-lead", "frontend-developer"],
            ["tech-lead", "devops-engineer"],
        ],
        "depends_on": ["design", "legal"],
        "requires_approval": True,
    },
    {
        "id": "testing",
        "name": "Тестирование",
        "description": "Проверка качества и безопасности",
        "agents": ["qa-engineer", "security-engineer"],
        "edges": [],
        "depends_on": ["development"],
        "requires_approval": True,
    },
    {
        "id": "release",
        "name": "Релиз",
        "description": "Подготовка и выпуск релиза",
        "agents": ["release-manager"],
        "edges": [],
        "depends_on": ["testing"],
        "requires_approval": False,
    },
    {
        "id": "marketing",
        "name": "Маркетинг",
        "description": "Продвижение продукта, SMM, контент",
        "agents": ["product-marketer", "smm-manager", "content-creator"],
        "edges": [
            ["product-marketer", "smm-manager"],
            ["product-marketer", "content-creator"],
        ],
        "depends_on": ["release"],
        "requires_approval": False,
    },
    {
        "id": "feedback",
        "name": "Фидбек",
        "description": "Поддержка пользователей и аналитика",
        "agents": ["customer-support", "data-analyst"],
        "edges": [],
        "depends_on": ["release"],
        "requires_approval": False,
    },
]


def get_agent_block(agent_id: str) -> str:
    """Возвращает ID блока, к которому принадлежит агент."""
    for block in DEFAULT_BLOCKS:
        if agent_id in block["agents"]:
            return block["id"]
    if agent_id in ("orchestrator",):
        return "meta"
    raise ValueError(f"Агент не найден ни в одном блоке: {agent_id}")


def get_agent_phase(agent_id: str) -> str:
    """Возвращает фазу, к которой принадлежит агент."""
    for phase, agents in PHASES.items():
        if agent_id in agents:
            return phase
    if agent_id in ("pipeline-architect", "orchestrator"):
        return "meta"
    raise ValueError(f"Неизвестный агент: {agent_id}")


def get_agent_dir(agent_id: str) -> Path:
    """Возвращает абсолютный путь к директории агента."""
    if agent_id not in AGENT_REGISTRY:
        raise ValueError(f"Агент не найден в реестре: {agent_id}")
    return BASE_DIR / AGENT_REGISTRY[agent_id]


# =============================================================================
# Определения gate-точек
# =============================================================================

GATES: Dict[str, Dict[str, Any]] = {
    "gate_1_build": {
        "name": "Gate 1: Строим?",
        "description": "Решение о запуске разработки после формирования брифа",
        "after_agents": ["product-owner"],
        "before_agents": ["pipeline-architect"],
        "decisions": ["go", "pivot", "stop"],
    },
    "gate_2_architecture": {
        "name": "Gate 2: Архитектура",
        "description": "Утверждение архитектуры и дизайна перед разработкой",
        "after_agents": ["system-architect", "ux-ui-designer"],
        "before_agents": ["tech-lead"],
        "decisions": ["go", "revise", "stop"],
    },
    "gate_3_go_nogo": {
        "name": "Gate 3: Go/No-go",
        "description": "Решение о релизе после проверки качества",
        "after_agents": ["qa-engineer", "security-engineer", "devops-engineer"],
        "before_agents": ["release-manager"],
        "decisions": ["go", "no-go", "rollback"],
    },
}

# =============================================================================
# Статусы
# =============================================================================

# Статусы проекта
PROJECT_STATUSES = ("running", "paused_at_gate", "completed", "failed")

# Статусы агента
AGENT_STATUSES = ("pending", "running", "completed", "skipped", "failed")

# Режимы работы
PIPELINE_MODES = ("auto", "human_approval")
