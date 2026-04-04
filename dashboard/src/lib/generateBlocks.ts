/**
 * Generate pipeline blocks from project description using Claude.
 * Called after project creation to auto-populate blocks with relevant agents.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import {
  getProjectState,
  saveProjectState,
  addAgentToBlock,
} from "./state";
import type { PipelineBlock } from "./types";

const AVAILABLE_AGENTS = [
  { id: "product-owner", name: "Product Owner", phase: "product", desc: "Определяет продуктовое видение, пользовательские истории, приоритеты" },
  { id: "business-analyst", name: "Business Analyst", phase: "product", desc: "Детальные требования, acceptance criteria, спецификации" },
  { id: "ux-ui-designer", name: "UX/UI Designer", phase: "design", desc: "Дизайн-система, вайрфреймы, макеты интерфейса" },
  { id: "system-architect", name: "System Architect", phase: "development", desc: "Архитектура, API-контракты, схема БД, технические решения" },
  { id: "tech-lead", name: "Tech Lead", phase: "development", desc: "Декомпозиция задач, распределение между разработчиками" },
  { id: "backend-developer", name: "Backend Developer", phase: "development", desc: "Серверная часть, API, БД, бизнес-логика" },
  { id: "frontend-developer", name: "Frontend Developer", phase: "development", desc: "Клиентская часть, UI компоненты, взаимодействие с API" },
  { id: "devops-engineer", name: "DevOps Engineer", phase: "infrastructure", desc: "Docker, CI/CD, деплой, мониторинг" },
  { id: "qa-engineer", name: "QA Engineer", phase: "quality", desc: "Тестирование, тест-планы, автотесты" },
  { id: "security-engineer", name: "Security Engineer", phase: "quality", desc: "Аудит безопасности, поиск уязвимостей" },
  { id: "legal-compliance", name: "Legal / Compliance", phase: "legal", desc: "Юридические вопросы, GDPR, обработка ПД" },
  { id: "release-manager", name: "Release Manager", phase: "release", desc: "Координация релиза, чеклисты, go/no-go" },
  { id: "product-marketer", name: "Product Marketer", phase: "marketing", desc: "Позиционирование, маркетинговая стратегия" },
  { id: "smm-manager", name: "SMM Manager", phase: "marketing", desc: "Соцсети, контент-план, продвижение" },
  { id: "content-creator", name: "Content Creator", phase: "marketing", desc: "Лендинг, тексты, визуал, контент" },
  { id: "customer-support", name: "Customer Support", phase: "feedback", desc: "Поддержка пользователей, FAQ, обратная связь" },
  { id: "data-analyst", name: "Data Analyst", phase: "feedback", desc: "Аналитика, метрики, A/B тесты" },
];

const PROMPT = `Ты — Pipeline Architect. Тебе дано описание продукта. Твоя задача — создать оптимальный набор блоков (фаз) пайплайна с нужными агентами.

## Доступные агенты

${AVAILABLE_AGENTS.map((a) => `- ${a.id}: ${a.desc}`).join("\n")}

## Правила

1. Создай от 2 до 6 блоков (фаз)
2. Каждый блок имеет: id (латиница, kebab-case), name (русский), description (русский, 1 предложение), agents (список id агентов), depends_on (список id блоков-зависимостей)
3. Первый блок НЕ имеет зависимостей
4. Каждый следующий блок зависит от предыдущего (цепочка) или от нескольких
5. product-owner и business-analyst ВСЕГДА в первом блоке
6. Если проект — веб-приложение или сайт, включи frontend-developer и ux-ui-designer
7. Если проект — бот, API, CLI — НЕ включай frontend-developer и ux-ui-designer
8. Если описание упоминает платежи или ПД — включи legal-compliance и security-engineer
9. Если проект публичный — включи маркетинговый блок
10. requires_approval: true для блоков перед разработкой и перед релизом, false для остальных
11. НЕ включай tech-lead если проект маленький (1 разработчик)
12. НЕ включай release-manager если нет отдельного релиза

## Формат ответа

Верни ТОЛЬКО JSON массив блоков, без обёртки и пояснений:

[
  {
    "id": "planning",
    "name": "Планирование",
    "description": "Сбор требований и определение продукта",
    "agents": ["product-owner", "business-analyst"],
    "depends_on": [],
    "requires_approval": true
  },
  ...
]`;

interface BlockDef {
  id: string;
  name: string;
  description?: string;
  agents: string[];
  depends_on: string[];
  requires_approval: boolean;
}

/**
 * Generate blocks for a project from its description.
 * Runs synchronously via claude --print.
 */
export function generateBlocksForProject(projectId: string): boolean {
  const state = getProjectState(projectId);
  if (!state) return false;

  // Don't regenerate if blocks already exist
  if (state.blocks && state.blocks.length > 0) return true;

  const description = state.description || state.name;

  const fullPrompt = `${PROMPT}\n\n## Описание продукта\n\n${description}`;

  try {
    // Write prompt to temp file to avoid shell escaping issues
    const os = require("os");
    const tmpFile = path.join(os.tmpdir(), `gen-blocks-${projectId}-${Date.now()}.md`);
    fs.writeFileSync(tmpFile, fullPrompt, "utf-8");

    const result = spawnSync(
      "/bin/sh",
      ["-c", `cat "${tmpFile}" | claude --print --model claude-haiku-4-5 --dangerously-skip-permissions`],
      {
        timeout: 60000,
        env: {
          ...process.env,
          PATH: "/Users/dmitry/.nvm/versions/node/v22.20.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        },
      }
    );

    try { fs.unlinkSync(tmpFile); } catch { /* */ }

    const output = result.stdout?.toString().trim() || "";
    if (!output) return false;

    // Parse JSON from output
    const blocks = parseBlocksJson(output);
    if (!blocks || blocks.length === 0) return false;

    // Apply blocks to state
    applyBlocks(projectId, blocks);
    return true;
  } catch {
    return false;
  }
}

function parseBlocksJson(output: string): BlockDef[] | null {
  // Try direct parse
  try { return JSON.parse(output); } catch { /* */ }

  // Try extracting JSON array from markdown
  const jsonMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[1].trim()); } catch { /* */ }
  }

  // Try finding array in output
  const arrayMatch = output.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try { return JSON.parse(arrayMatch[0]); } catch { /* */ }
  }

  return null;
}

function applyBlocks(projectId: string, blockDefs: BlockDef[]): void {
  const state = getProjectState(projectId);
  if (!state) return;

  const validAgentIds = new Set(AVAILABLE_AGENTS.map((a) => a.id));

  // Create blocks
  state.blocks = blockDefs.map((def) => {
    const block: PipelineBlock = {
      id: def.id,
      name: def.name,
      description: def.description,
      agents: def.agents.filter((a) => validAgentIds.has(a)),
      edges: [],
      depends_on: def.depends_on || [],
      requires_approval: def.requires_approval ?? false,
    };
    return block;
  });

  // Initialize agent states and pipeline_graph nodes
  const allAgents = state.blocks.flatMap((b) => b.agents);
  state.pipeline_graph.nodes = [...new Set(allAgents)];

  for (const agentId of allAgents) {
    if (!state.agents[agentId]) {
      state.agents[agentId] = {
        status: "pending",
        started_at: null,
        completed_at: null,
        artifacts: [],
        error: null,
      };
    }
  }

  state.updated_at = new Date().toISOString();
  saveProjectState(projectId, state);
}
