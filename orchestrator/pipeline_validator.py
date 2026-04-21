"""
Слой проверки графа после Pipeline Architect.

Применяет детерминированные правила к pipeline-graph.json от PA:
- Удаляет агентов, которые не нужны для типа продукта (бот без UI → нет дизайнера/фронта).
- Сообщает «листовых» агентов (никто не зависит) — кандидатов на исключение.

Правила консервативные: при сомнениях оставляем агента в графе, но логируем warning.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Set, Tuple, Any


# Признаки продукта, которые включают/выключают целые ветки.
# Источник правды — описание проекта (state.description) + product_brief PO.
@dataclass
class ProductFlags:
    has_web_ui: bool = True
    has_mobile_ui: bool = False
    is_bot: bool = False
    is_api_only: bool = False
    distribution_channels: Set[str] = field(default_factory=set)  # {"telegram","instagram","youtube","web"}
    is_public: bool = True
    has_payments: bool = False


# Правила: какие агенты исключить при определённых флагах.
# Каждое правило: (условие → причина исключения → список agent_id)
RULES: List[Tuple[str, str, callable, List[str]]] = [
    (
        "no_visual_ui",
        "Продукт не имеет визуального UI (только conversational/API) — визуальный дизайнер и фронтенд не нужны.",
        lambda f: not f.has_web_ui and not f.has_mobile_ui,
        ["ux-ui-designer", "frontend-developer"],
    ),
    (
        "no_telegram_channel",
        "Нет публикации в Telegram → telegram-poster не нужен.",
        lambda f: "telegram" not in f.distribution_channels,
        ["telegram-poster"],
    ),
    (
        "no_instagram_channel",
        "Нет публикации в Instagram → instagram-poster не нужен.",
        lambda f: "instagram" not in f.distribution_channels,
        ["instagram-poster"],
    ),
    (
        "no_youtube_channel",
        "Нет публикации в YouTube → youtube-poster не нужен.",
        lambda f: "youtube" not in f.distribution_channels,
        ["youtube-poster"],
    ),
    (
        "internal_product",
        "Внутренний продукт → маркетинговая ветка не нужна.",
        lambda f: not f.is_public,
        ["product-marketer", "smm-manager", "content-creator"],
    ),
]


def detect_product_flags(description: str, product_brief: str = "") -> ProductFlags:
    """Эвристика на основе описания. Лучше переопределить через явные поля в SUMMARY PO."""
    text = (description + " " + product_brief).lower()
    flags = ProductFlags()

    bot_kw = ["telegram-бот", "telegram бот", "tg-бот", "discord-бот", "slack-бот", "chat bot", "чат-бот"]
    if any(kw in text for kw in bot_kw):
        flags.is_bot = True
        flags.has_web_ui = False
        flags.has_mobile_ui = False

    api_kw = ["api only", "только api", "headless", "json api"]
    if any(kw in text for kw in api_kw):
        flags.is_api_only = True
        flags.has_web_ui = False
        flags.has_mobile_ui = False

    if "telegram" in text:
        flags.distribution_channels.add("telegram")
    if "instagram" in text:
        flags.distribution_channels.add("instagram")
    if "youtube" in text:
        flags.distribution_channels.add("youtube")

    if "внутренний" in text or "internal tool" in text:
        flags.is_public = False

    if "оплат" in text or "плат" in text or "stars" in text or "stripe" in text or "tinkoff" in text:
        flags.has_payments = True

    return flags


@dataclass
class ValidationResult:
    kept: List[str]
    removed: List[Tuple[str, str]]  # (agent_id, reason)
    warnings: List[str]
    leaf_agents: List[str]          # агенты, от которых никто не зависит — кандидаты на pruning


def validate(
    pa_nodes: List[Dict[str, Any]],
    flags: ProductFlags,
) -> ValidationResult:
    """Применяет правила к графу PA. pa_nodes — список словарей из pipeline-graph.json."""
    agent_nodes = [n for n in pa_nodes if n.get("type") != "gate"]
    node_ids = [n["id"] for n in agent_nodes]
    deps_of: Dict[str, Set[str]] = {n["id"]: set(n.get("depends_on", [])) for n in agent_nodes}
    has_dependants: Set[str] = set()
    for deps in deps_of.values():
        has_dependants.update(deps)

    removed: List[Tuple[str, str]] = []
    to_remove: Set[str] = set()
    warnings: List[str] = []

    for rule_id, reason, predicate, victims in RULES:
        if not predicate(flags):
            continue
        for v in victims:
            if v in node_ids and v not in to_remove:
                to_remove.add(v)
                removed.append((v, f"[{rule_id}] {reason}"))

    kept = [aid for aid in node_ids if aid not in to_remove]

    # Листовые агенты (после удаления) — кто остался без dependants и без обоснованных артефактов
    leaf_agents: List[str] = []
    new_has_dependants: Set[str] = set()
    for aid, deps in deps_of.items():
        if aid in to_remove:
            continue
        new_has_dependants.update(d for d in deps if d not in to_remove)
    for aid in kept:
        if aid not in new_has_dependants:
            # Допустим: terminal-агенты (data-analyst, security-engineer и т.п.) — норма.
            # Помечаем только если он в "design"/"prep" фазе, что подозрительно.
            phase = next((n.get("phase") for n in agent_nodes if n["id"] == aid), "")
            if phase in {"design", "product"}:
                leaf_agents.append(aid)
                warnings.append(
                    f"Агент {aid} ({phase}) не имеет зависимых — возможно, его выход никто не использует."
                )

    return ValidationResult(kept=kept, removed=removed, warnings=warnings, leaf_agents=leaf_agents)


def render_report(res: ValidationResult) -> str:
    """Текстовый отчёт для логов / DECISIONS.md."""
    lines = ["# Pipeline Validator", ""]
    lines.append(f"**Оставлено агентов:** {len(res.kept)}")
    lines.append("")
    if res.removed:
        lines.append("**Удалены:**")
        for aid, reason in res.removed:
            lines.append(f"- `{aid}` — {reason}")
        lines.append("")
    if res.leaf_agents:
        lines.append("**Подозрительные «листья» (никто не использует выход):**")
        for aid in res.leaf_agents:
            lines.append(f"- `{aid}`")
        lines.append("")
    if res.warnings:
        lines.append("**Предупреждения:**")
        for w in res.warnings:
            lines.append(f"- {w}")
    return "\n".join(lines)
