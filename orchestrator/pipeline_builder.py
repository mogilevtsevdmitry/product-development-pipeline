"""
Pipeline Architect — сборка динамического графа пайплайна по брифу продукта.

Определяет, какие агенты нужны, на основе характеристик продукта:
- Есть ПД → Legal обязателен
- Есть платежи → Security + Legal
- Публичный продукт → Marketing ветка
- Внутренний инструмент → без маркетинга
- MVP → минимальный набор агентов
- Production → полный набор
"""

from typing import Dict, List, Any, Tuple, Optional


# =============================================================================
# Статическая начальная цепочка (всегда одинаковая)
# =============================================================================

STATIC_CHAIN: List[str] = [
    "problem-researcher",
    "market-researcher",
    "product-owner",
]

# =============================================================================
# Полный граф пайплайна по умолчанию
# =============================================================================

DEFAULT_FULL_GRAPH: Dict[str, Any] = {
    "nodes": [
        # Исследование
        "problem-researcher",
        "market-researcher",
        # Продукт
        "product-owner",
        "business-analyst",
        # Мета
        "pipeline-architect",
        # Юридическое
        "legal-compliance",
        # Дизайн
        "ux-ui-designer",
        # Разработка
        "system-architect",
        "tech-lead",
        "backend-developer",
        "frontend-developer",
        "devops-engineer",
        # Качество
        "qa-engineer",
        "security-engineer",
        # Релиз
        "release-manager",
        # Маркетинг
        "product-marketer",
        "smm-manager",
        "content-creator",
        # Фидбек
        "customer-support",
        "data-analyst",
    ],
    "edges": [
        # Статическая цепочка
        ["problem-researcher", "market-researcher"],
        ["market-researcher", "product-owner"],
        # Gate 1 → Pipeline Architect
        ["product-owner", "pipeline-architect"],
        # Параллельные ветки после Pipeline Architect
        ["pipeline-architect", "business-analyst"],
        ["pipeline-architect", "system-architect"],
        ["pipeline-architect", "ux-ui-designer"],
        ["pipeline-architect", "legal-compliance"],
        # BA → Tech Lead
        ["business-analyst", "tech-lead"],
        # Gate 2 → Tech Lead
        ["system-architect", "tech-lead"],
        ["ux-ui-designer", "tech-lead"],
        # Tech Lead → параллельная разработка
        ["tech-lead", "backend-developer"],
        ["tech-lead", "frontend-developer"],
        ["tech-lead", "devops-engineer"],
        # Разработка → Качество
        ["backend-developer", "qa-engineer"],
        ["frontend-developer", "qa-engineer"],
        ["backend-developer", "security-engineer"],
        ["frontend-developer", "security-engineer"],
        # Gate 3 → Release Manager
        ["qa-engineer", "release-manager"],
        ["security-engineer", "release-manager"],
        ["devops-engineer", "release-manager"],
        # Release → Marketing
        ["release-manager", "product-marketer"],
        ["product-marketer", "smm-manager"],
        ["product-marketer", "content-creator"],
        # Release → Feedback
        ["release-manager", "customer-support"],
        ["release-manager", "data-analyst"],
    ],
    "parallel_groups": [
        ["business-analyst", "system-architect", "ux-ui-designer", "legal-compliance"],
        ["backend-developer", "frontend-developer", "devops-engineer"],
        ["qa-engineer", "security-engineer"],
        ["product-marketer", "customer-support", "data-analyst"],
        ["smm-manager", "content-creator"],
    ],
}


def build_pipeline(product_brief: Dict[str, Any]) -> Dict[str, Any]:
    """
    Собирает граф пайплайна на основе брифа продукта.

    Анализирует бриф и определяет, какие агенты включить в пайплайн
    на основе правил:
    - has_personal_data → legal-compliance обязателен
    - has_payments → security-engineer + legal-compliance
    - is_public → маркетинговая ветка (product-marketer, smm-manager, content-creator)
    - is_internal → без маркетинговой ветки
    - scope == "mvp" → минимальный набор агентов
    - scope == "production" → полный набор

    Args:
        product_brief: Словарь с характеристиками продукта:
            - name (str): Название продукта
            - description (str): Описание
            - scope (str): "mvp" или "production"
            - is_public (bool): Публичный продукт или внутренний
            - has_personal_data (bool): Обрабатывает ПД
            - has_payments (bool): Есть платежи
            - product_type (str): Тип продукта (опционально)

    Returns:
        Граф пайплайна: {nodes, edges, parallel_groups}
    """
    scope: str = product_brief.get("scope", "production")
    is_public: bool = product_brief.get("is_public", True)
    has_pd: bool = product_brief.get("has_personal_data", False)
    has_payments: bool = product_brief.get("has_payments", False)

    if scope == "mvp":
        return _build_mvp_pipeline(product_brief)

    return _build_full_pipeline(
        is_public=is_public,
        has_pd=has_pd,
        has_payments=has_payments,
    )


def _build_mvp_pipeline(brief: Dict[str, Any]) -> Dict[str, Any]:
    """
    Собирает минимальный MVP-пайплайн (8-9 узлов).

    Args:
        brief: Бриф продукта.

    Returns:
        Граф минимального пайплайна.
    """
    is_public: bool = brief.get("is_public", True)

    nodes: List[str] = [
        "problem-researcher",
        "market-researcher",
        "product-owner",
        "pipeline-architect",
        "business-analyst",
        "backend-developer",
        "frontend-developer",
        "devops-engineer",
        "qa-engineer",
    ]

    edges: List[List[str]] = [
        ["problem-researcher", "market-researcher"],
        ["market-researcher", "product-owner"],
        ["product-owner", "pipeline-architect"],
        ["pipeline-architect", "business-analyst"],
        ["business-analyst", "backend-developer"],
        ["business-analyst", "frontend-developer"],
        ["backend-developer", "qa-engineer"],
        ["frontend-developer", "qa-engineer"],
        ["qa-engineer", "devops-engineer"],
    ]

    parallel_groups: List[List[str]] = [
        ["backend-developer", "frontend-developer"],
    ]

    # Для публичных MVP добавляем content-creator
    if is_public:
        nodes.append("content-creator")
        edges.append(["devops-engineer", "content-creator"])

    return {
        "nodes": nodes,
        "edges": edges,
        "parallel_groups": parallel_groups,
    }


def _build_full_pipeline(
    is_public: bool,
    has_pd: bool,
    has_payments: bool,
) -> Dict[str, Any]:
    """
    Собирает полный пайплайн с учётом характеристик продукта.

    Args:
        is_public: Публичный продукт (включает маркетинг).
        has_pd: Обрабатывает персональные данные (включает legal).
        has_payments: Есть платежи (включает security + legal).

    Returns:
        Граф полного пайплайна.
    """
    # Начинаем с полного графа и убираем ненужное
    nodes: List[str] = list(DEFAULT_FULL_GRAPH["nodes"])
    edges: List[List[str]] = [list(e) for e in DEFAULT_FULL_GRAPH["edges"]]
    parallel_groups: List[List[str]] = [
        list(g) for g in DEFAULT_FULL_GRAPH["parallel_groups"]
    ]

    agents_to_remove: List[str] = []

    # Маркетинговая ветка только для публичных продуктов
    if not is_public:
        agents_to_remove.extend([
            "product-marketer",
            "smm-manager",
            "content-creator",
        ])

    # Legal нужен если есть ПД или платежи
    if not has_pd and not has_payments:
        agents_to_remove.append("legal-compliance")

    # Security обязателен если есть платежи (иначе опционален, но оставляем)
    # Security остаётся в полном пайплайне по умолчанию

    # Удаляем ненужных агентов
    if agents_to_remove:
        nodes = [n for n in nodes if n not in agents_to_remove]
        edges = [
            e for e in edges
            if e[0] not in agents_to_remove and e[1] not in agents_to_remove
        ]
        parallel_groups = [
            [a for a in group if a not in agents_to_remove]
            for group in parallel_groups
        ]
        # Убираем пустые группы
        parallel_groups = [g for g in parallel_groups if len(g) > 1]

    return {
        "nodes": nodes,
        "edges": edges,
        "parallel_groups": parallel_groups,
    }


def get_agent_dependencies(graph: Dict[str, Any], agent_id: str) -> List[str]:
    """
    Возвращает список агентов, от которых зависит данный агент.

    Args:
        graph: Граф пайплайна.
        agent_id: ID агента.

    Returns:
        Список ID агентов-зависимостей (входящие рёбра).
    """
    return [
        edge[0] for edge in graph.get("edges", [])
        if edge[1] == agent_id
    ]


def get_agent_dependents(graph: Dict[str, Any], agent_id: str) -> List[str]:
    """
    Возвращает список агентов, которые зависят от данного агента.

    Args:
        graph: Граф пайплайна.
        agent_id: ID агента.

    Returns:
        Список ID агентов-зависимых (исходящие рёбра).
    """
    return [
        edge[1] for edge in graph.get("edges", [])
        if edge[0] == agent_id
    ]


def validate_graph(graph: Dict[str, Any]) -> List[str]:
    """
    Валидирует граф пайплайна на корректность.

    Проверяет:
    - Все узлы в рёбрах существуют в nodes
    - Нет циклов (простая проверка)
    - Параллельные группы содержат существующие узлы

    Args:
        graph: Граф для валидации.

    Returns:
        Список ошибок (пустой если граф корректен).
    """
    errors: List[str] = []
    nodes_set = set(graph.get("nodes", []))

    # Проверка рёбер
    for edge in graph.get("edges", []):
        if edge[0] not in nodes_set:
            errors.append(f"Узел '{edge[0]}' в ребре не найден в nodes")
        if edge[1] not in nodes_set:
            errors.append(f"Узел '{edge[1]}' в ребре не найден в nodes")

    # Проверка параллельных групп
    for group in graph.get("parallel_groups", []):
        for agent_id in group:
            if agent_id not in nodes_set:
                errors.append(
                    f"Узел '{agent_id}' в параллельной группе не найден в nodes"
                )

    # Проверка что статическая цепочка на месте
    for agent_id in STATIC_CHAIN:
        if agent_id not in nodes_set:
            errors.append(
                f"Обязательный агент '{agent_id}' отсутствует в графе"
            )

    return errors
