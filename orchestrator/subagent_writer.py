"""
Генерация .claude/agents/<id>.md из system-prompt.md + rules.md.

Делает определения наших пайплайн-агентов доступными в интерактивном Claude Code
как настоящие subagents (Task tool, /agents). Идемпотентно перезаписывает файлы.
"""

import re
from pathlib import Path
from typing import Dict, Optional


def _strip_frontmatter(text: str) -> str:
    """Удаляет ведущий YAML frontmatter (--- ... ---) если он есть."""
    m = re.match(r"^---\s*\n.*?\n---\s*\n", text, re.DOTALL)
    return text[m.end():] if m else text

from config import AGENT_REGISTRY, BASE_DIR, get_agent_dir, get_agent_phase

CLAUDE_AGENTS_DIR = BASE_DIR / ".claude" / "agents"

# Краткие описания для frontmatter (description = триггер subagent-роутера CC)
_DESCRIPTIONS: Dict[str, str] = {
    "problem-researcher": "Use when researching a product problem space, user pains, jobs-to-be-done.",
    "market-researcher":  "Use for market sizing, competitor scan, segment analysis.",
    "product-owner":      "Use to turn research into a product brief, MVP scope, success metrics.",
    "business-analyst":   "Use to formalize requirements, user stories, acceptance criteria.",
    "pipeline-architect": "Use to design the pipeline DAG of agents for a given product brief.",
    "legal-compliance":   "Use for legal/compliance review (GDPR, payments, age-gate).",
    "ux-ui-designer":     "Use to design wireframes, design system, user flows.",
    "system-architect":   "Use for system architecture, API contracts, DB schema, NFR.",
    "tech-lead":          "Use to break architecture into per-developer task plans.",
    "backend-developer":  "Use to implement backend slices defined by tech-lead.",
    "frontend-developer": "Use to implement frontend slices defined by tech-lead.",
    "devops-engineer":    "Use for CI/CD, infra, deployment pipelines, observability.",
    "qa-engineer":        "Use for test plan, e2e/integration tests, regression checks.",
    "security-engineer":  "Use for threat model, security review, vuln scan.",
    "release-manager":    "Use to plan and orchestrate the release.",
    "product-marketer":   "Use for positioning, messaging, launch plan.",
    "smm-manager":        "Use for SMM strategy and channel plan.",
    "content-creator":    "Use to produce launch content artifacts.",
    "customer-support":   "Use to set up support playbooks and FAQ.",
    "data-analyst":       "Use for analytics setup, dashboards, KPI tracking.",
}


def write_subagent_files(force: bool = False) -> int:
    """Пишет .claude/agents/<id>.md для всех агентов из реестра.

    Args:
        force: Перезаписывать существующие файлы.

    Returns:
        Количество записанных файлов.
    """
    CLAUDE_AGENTS_DIR.mkdir(parents=True, exist_ok=True)
    written = 0

    for agent_id in AGENT_REGISTRY:
        target = CLAUDE_AGENTS_DIR / f"{agent_id}.md"
        if target.exists() and not force:
            continue

        content = _build_subagent_md(agent_id)
        if content is None:
            continue

        target.write_text(content, encoding="utf-8")
        written += 1

    return written


def _build_subagent_md(agent_id: str) -> Optional[str]:
    """Собирает содержимое .claude/agents/<id>.md."""
    try:
        agent_dir = get_agent_dir(agent_id)
    except ValueError:
        return None

    sys_prompt_file = agent_dir / "system-prompt.md"
    rules_file = agent_dir / "rules.md"

    if not sys_prompt_file.exists():
        return None

    system_prompt = _strip_frontmatter(sys_prompt_file.read_text(encoding="utf-8")).strip()
    rules = (
        _strip_frontmatter(rules_file.read_text(encoding="utf-8")).strip()
        if rules_file.exists() else ""
    )

    description = _DESCRIPTIONS.get(
        agent_id,
        f"Pipeline agent: {agent_id}. Use when this role is needed.",
    )

    parts = [
        "---",
        f"name: {agent_id}",
        f"description: {description}",
        "---",
        "",
        system_prompt,
    ]
    if rules:
        parts.extend(["", "# Правила", "", rules])

    try:
        phase = get_agent_phase(agent_id)
    except ValueError:
        phase = "unknown"
    parts.extend([
        "",
        f"<!-- pipeline-phase: {phase} -->",
        "",
    ])

    return "\n".join(parts)


if __name__ == "__main__":
    import sys

    force = "--force" in sys.argv
    n = write_subagent_files(force=force)
    print(f"Записано .claude/agents/*.md: {n}")
