import type { DebateRound, DebateRoles } from "./types";
import fs from "fs";
import path from "path";

const AGENTS_DIR = path.resolve(process.cwd(), "..", "agents");
const AGENTS_CONFIG_PATH = path.join(AGENTS_DIR, "agents-config.json");

// Agent display names fallback
const AGENT_LABELS: Record<string, string> = {
  "problem-researcher": "Problem Researcher",
  "market-researcher": "Market Researcher",
  "product-owner": "Product Owner",
  "pipeline-architect": "Pipeline Architect",
  "business-analyst": "Business Analyst",
  "legal-compliance": "Legal / Compliance",
  "ux-ui-designer": "UX/UI Designer",
  "system-architect": "System Architect",
  "tech-lead": "Tech Lead",
  "backend-developer": "Backend Developer",
  "frontend-developer": "Frontend Developer",
  "devops-engineer": "DevOps Engineer",
  "qa-engineer": "QA Engineer",
  "security-engineer": "Security Engineer",
  "release-manager": "Release Manager",
  "product-marketer": "Product Marketer",
  "smm-manager": "SMM Manager",
  "content-creator": "Content Creator",
  "customer-support": "Customer Support",
  "data-analyst": "Data Analyst",
};

/**
 * Load system-prompt.md for an agent by ID.
 * Looks up agent path in agents-config.json, then reads system-prompt.md.
 */
export function loadAgentPrompt(agentId: string): string {
  try {
    // Try agents-config.json first
    if (fs.existsSync(AGENTS_CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(AGENTS_CONFIG_PATH, "utf-8"));
      const agentConfig = config[agentId];
      if (agentConfig?.path) {
        const promptPath = path.join(
          path.resolve(process.cwd(), ".."),
          agentConfig.path,
          "system-prompt.md"
        );
        if (fs.existsSync(promptPath)) {
          return fs.readFileSync(promptPath, "utf-8");
        }
      }
    }

    // Fallback: search common paths
    const searchPaths = [
      path.join(AGENTS_DIR, "**", agentId, "system-prompt.md"),
    ];
    // Try known phases
    for (const phase of ["product", "research", "design", "development", "quality", "release", "marketing", "feedback", "legal", "meta", "hq"]) {
      const p = path.join(AGENTS_DIR, phase, agentId, "system-prompt.md");
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
    }
  } catch { /* */ }

  return "";
}

/**
 * Get agent display name.
 */
export function getAgentName(agentId: string): string {
  try {
    if (fs.existsSync(AGENTS_CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(AGENTS_CONFIG_PATH, "utf-8"));
      if (config[agentId]?.name) return config[agentId].name;
    }
  } catch { /* */ }
  return AGENT_LABELS[agentId] || agentId;
}

/**
 * List all available agents for selection.
 */
export function listAvailableAgents(): { id: string; name: string; role: string; phase: string }[] {
  try {
    if (fs.existsSync(AGENTS_CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(AGENTS_CONFIG_PATH, "utf-8"));
      return Object.entries(config).map(([id, cfg]: [string, any]) => ({
        id,
        name: cfg.name || AGENT_LABELS[id] || id,
        role: cfg.role || "",
        phase: cfg.phase || "",
      }));
    }
  } catch { /* */ }

  // Fallback
  return Object.entries(AGENT_LABELS).map(([id, name]) => ({
    id, name, role: "", phase: "",
  }));
}

// ============================================================================
// Prompt builders — load agent system-prompt.md and wrap with debate role
// ============================================================================

function formatPreviousRounds(rounds: DebateRound[]): string {
  if (rounds.length === 0) return "Это первый раунд. Предыдущих обсуждений нет.";

  return rounds.map((r) => {
    let text = `\n### Раунд ${r.round}\n`;
    if (r.analyst) text += `\n**Аналитик:**\n${r.analyst.output}\n`;
    if (r.producer) text += `\n**Производитель:**\n${r.producer.output}\n`;
    if (r.controller) {
      text += `\n**Контролёр** (вердикт: ${r.controller.verdict}):\n${r.controller.output}\n`;
    }
    return text;
  }).join("\n---\n");
}

const ROLE_WRAPPERS = {
  analyst: {
    firstRound: `Это первый раунд. Тебе нужно:
1. Проанализировать задачу — что на самом деле нужно?
2. Определить главный фокус — что самое важное?
3. Выделить ограничения и риски
4. Дать чёткое направление Производителю: что делать В ПЕРВУЮ ОЧЕРЕДЬ

НЕ пытайся решить всё сразу. Определи MVP — минимальный результат, который уже полезен.`,
    nextRound: `Изучи предыдущие раунды. Тебе нужно:
1. Оценить замечания Контролёра — какие критичные, какие можно отложить?
2. Приоритизировать: что исправлять в первую очередь?
3. Есть ли смысл менять направление (pivot)?
4. Дать обновлённое направление Производителю`,
    format: `В конце обязательно напиши строку:
ФОКУС: <одно предложение — главный приоритет этого раунда>

Пиши на русском. Будь кратким — не более 300 слов.`,
  },
  producer: {
    firstRound: `Создай ПОЛНУЮ первую версию. Не заглушки, не TODO — рабочий результат.
Следуй фокусу Аналитика. Если задача требует код — пиши код. Если текст — пиши текст.`,
    format: `Выведи готовый артефакт целиком (обновлённую версию).
В начале кратко (2-3 предложения) опиши что изменил по сравнению с предыдущей версией.

Пиши на русском (код и технические термины на английском).`,
  },
  controller: {
    checks: `Проверь результат Производителя:
1. **Соответствие задаче** — решает ли это то, что просил человек?
2. **Соответствие фокусу** — следует ли направлению Аналитика?
3. **Качество** — есть ли ошибки, пробелы, слабые места?
4. **Полнота** — всё ли реализовано или есть пропуски?`,
    format: `1. Краткая оценка (2-3 предложения)
2. Список замечаний (если есть), по приоритету:
   - 🚫 Блокер: ...
   - ⚠️ Важно: ...
   - 💡 Рекомендация: ...
3. В САМОМ КОНЦЕ обязательно одна из строк:

РЕШЕНИЕ: sign-off
РЕШЕНИЕ: issues
РЕШЕНИЕ: blocker

- sign-off — результат ИДЕАЛЕН, замечаний НЕТ ВООБЩЕ, можно отдавать человеку как есть
- issues — есть ЛЮБЫЕ замечания (даже рекомендации), нужен ещё раунд для доработки
- blocker — фундаментальная проблема, нужно менять подход

ВАЖНО: Если ты написал хотя бы одно замечание (🚫, ⚠️ или 💡) — ставь РЕШЕНИЕ: issues.
Sign-off означает что ты НЕ нашёл ни одного замечания и результат можно отдавать без изменений.

Пиши на русском. Будь конкретным.`,
  },
};

export function buildAnalystPrompt(
  task: string,
  rounds: DebateRound[],
  roundNumber: number,
  agentId: string
): string {
  const agentPrompt = loadAgentPrompt(agentId);
  const agentName = getAgentName(agentId);
  const isFirst = roundNumber === 1;
  const history = formatPreviousRounds(rounds);

  return `${agentPrompt ? `# Системный промпт агента: ${agentName}\n\n${agentPrompt}\n\n---\n\n` : ""}# Роль в штабе: Аналитик

Ты выполняешь роль АНАЛИТИКА в штабе агентов. Смотри на картину целиком, определяй приоритеты и направляй команду.

## Задача от человека

${task}

## Предыдущие раунды

${history}

## Текущий раунд: ${roundNumber}

${isFirst ? ROLE_WRAPPERS.analyst.firstRound : ROLE_WRAPPERS.analyst.nextRound}

## Формат ответа

${ROLE_WRAPPERS.analyst.format}`;
}

export function buildProducerPrompt(
  task: string,
  analystOutput: string,
  rounds: DebateRound[],
  roundNumber: number,
  agentId: string
): string {
  const agentPrompt = loadAgentPrompt(agentId);
  const agentName = getAgentName(agentId);
  const isFirst = roundNumber === 1;
  const previousFeedback = rounds.length > 0
    ? rounds[rounds.length - 1]?.controller?.output || ""
    : "";

  return `${agentPrompt ? `# Системный промпт агента: ${agentName}\n\n${agentPrompt}\n\n---\n\n` : ""}# Роль в штабе: Производитель

Ты выполняешь роль ПРОИЗВОДИТЕЛЯ в штабе агентов. Создавай артефакт по задаче.

## Задача от человека

${task}

## Направление от Аналитика (раунд ${roundNumber})

${analystOutput}

${!isFirst && previousFeedback ? `## Замечания Контролёра из предыдущего раунда

${previousFeedback}

Исправь указанные проблемы. Не переделывай то, что работает.` : ""}

## Текущий раунд: ${roundNumber}

${isFirst ? ROLE_WRAPPERS.producer.firstRound : `Улучши предыдущую версию. Раунд ${roundNumber} из 3${roundNumber === 3 ? " — ФИНАЛЬНЫЙ, доведи до максимального качества." : "."}`}

## Формат ответа

${ROLE_WRAPPERS.producer.format}`;
}

export function buildControllerPrompt(
  task: string,
  producerOutput: string,
  analystFocus: string,
  rounds: DebateRound[],
  roundNumber: number,
  agentId: string
): string {
  const agentPrompt = loadAgentPrompt(agentId);
  const agentName = getAgentName(agentId);

  return `${agentPrompt ? `# Системный промпт агента: ${agentName}\n\n${agentPrompt}\n\n---\n\n` : ""}# Роль в штабе: Контролёр

Ты выполняешь роль КОНТРОЛЁРА в штабе агентов. Находи ошибки, слабые места и давай feedback.

## Задача от человека

${task}

## Фокус Аналитика

${analystFocus}

## Результат Производителя (раунд ${roundNumber})

${producerOutput}

${rounds.length > 0 ? `## Предыдущие раунды\n\n${formatPreviousRounds(rounds)}` : ""}

## Текущий раунд: ${roundNumber} из 3

${ROLE_WRAPPERS.controller.checks}
${roundNumber > 1 ? `5. **Прогресс** — исправлены ли замечания из предыдущего раунда?` : ""}

НЕ придирайся к мелочам. Фокусируйся на том, что РЕАЛЬНО влияет на результат.
${roundNumber === 3 ? "Это ФИНАЛЬНЫЙ раунд. Если результат достаточно хорош — дай sign-off." : ""}

## Формат ответа

${ROLE_WRAPPERS.controller.format}`;
}
