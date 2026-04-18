/**
 * Generate pipeline blocks from project description using Claude.
 * Called after project creation to auto-populate blocks with relevant agents.
 */
import { spawn } from "child_process";
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
// Haiku 4.5 pricing per 1M tokens (USD)
const PRICE_INPUT_PER_M = 1.0;
const PRICE_OUTPUT_PER_M = 5.0;
const PRICE_CACHE_READ_PER_M = 0.1;
const PRICE_CACHE_WRITE_PER_M = 1.25;

function computeCost(u: { input: number; output: number; cacheRead: number; cacheWrite: number }): number {
  return (
    (u.input / 1_000_000) * PRICE_INPUT_PER_M +
    (u.output / 1_000_000) * PRICE_OUTPUT_PER_M +
    (u.cacheRead / 1_000_000) * PRICE_CACHE_READ_PER_M +
    (u.cacheWrite / 1_000_000) * PRICE_CACHE_WRITE_PER_M
  );
}

export function generateBlocksForProject(projectId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const state = getProjectState(projectId);
    if (!state) return resolve(false);

    if (state.blocks && state.blocks.length > 0) {
      state.generation_status = "done";
      state.generation_error = undefined;
      saveProjectState(projectId, state);
      return resolve(true);
    }

    state.generation_status = "generating";
    state.generation_error = undefined;
    state.generation_tokens_in = 0;
    state.generation_tokens_out = 0;
    state.generation_cost_usd = 0;
    state.generation_started_at = new Date().toISOString();
    saveProjectState(projectId, state);

    const description = state.description || state.name;
    const fullPrompt = `${PROMPT}\n\n## Описание продукта\n\n${description}`;

    const markFailed = (msg: string) => {
      const s = getProjectState(projectId);
      if (!s) return;
      s.generation_status = "failed";
      s.generation_error = msg;
      saveProjectState(projectId, s);
    };

    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let assistantText = "";
    let finalCostUsd: number | null = null;
    let lastPersist = 0;

    const persistUsage = (force = false) => {
      const now = Date.now();
      if (!force && now - lastPersist < 400) return;
      lastPersist = now;
      const s = getProjectState(projectId);
      if (!s) return;
      s.generation_tokens_in = usage.input + usage.cacheRead + usage.cacheWrite;
      s.generation_tokens_out = usage.output;
      s.generation_cost_usd = finalCostUsd ?? computeCost(usage);
      saveProjectState(projectId, s);
    };

    try {
      const child = spawn(
        "claude",
        [
          "--print",
          "--input-format", "text",
          "--output-format", "stream-json",
          "--verbose",
          "--model", "claude-haiku-4-5",
          "--dangerously-skip-permissions",
        ],
        {
          env: {
            ...process.env,
            PATH: `${process.env.HOME}/.local/bin:/opt/homebrew/bin:/Users/dmitry/.nvm/versions/node/v22.20.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
          },
          stdio: ["pipe", "pipe", "pipe"],
        }
      );

      let settled = false;
      const finish = (fn: () => void) => { if (!settled) { settled = true; fn(); } };
      const timer = setTimeout(() => {
        try { child.kill("SIGTERM"); } catch { /* */ }
        finish(() => {
          markFailed("Превышен таймаут 120s при запросе к Claude");
          resolve(false);
        });
      }, 120_000);

      child.on("error", (err) => {
        clearTimeout(timer);
        finish(() => {
          markFailed(`Не удалось запустить claude CLI: ${err.message}`);
          resolve(false);
        });
      });

      let stdoutBuf = "";
      let stderrBuf = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuf += chunk.toString();
        let nl;
        while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
          const line = stdoutBuf.slice(0, nl).trim();
          stdoutBuf = stdoutBuf.slice(nl + 1);
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            const u = evt?.message?.usage ?? evt?.usage;
            if (u) {
              if (typeof u.input_tokens === "number") usage.input = u.input_tokens;
              if (typeof u.output_tokens === "number") usage.output = u.output_tokens;
              if (typeof u.cache_read_input_tokens === "number") usage.cacheRead = u.cache_read_input_tokens;
              if (typeof u.cache_creation_input_tokens === "number") usage.cacheWrite = u.cache_creation_input_tokens;
            }
            if (typeof evt?.total_cost_usd === "number") finalCostUsd = evt.total_cost_usd;
            if (evt?.type === "assistant" && Array.isArray(evt.message?.content)) {
              for (const c of evt.message.content) {
                if (c?.type === "text" && typeof c.text === "string") assistantText += c.text;
              }
            }
            if (evt?.type === "result" && typeof evt.result === "string") {
              assistantText = evt.result;
            }
            persistUsage();
          } catch { /* not JSON — ignore */ }
        }
      });
      child.stderr.on("data", (c: Buffer) => { stderrBuf += c.toString(); });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (settled) return;
        persistUsage(true);
        if (code !== 0) {
          finish(() => {
            markFailed(`claude CLI завершился с кодом ${code}${stderrBuf ? `: ${stderrBuf.trim().slice(0, 300)}` : ""}`);
            resolve(false);
          });
          return;
        }
        const output = assistantText.trim();
        if (!output) {
          finish(() => { markFailed("Claude вернул пустой ответ"); resolve(false); });
          return;
        }
        const blocks = parseBlocksJson(output);
        if (!blocks || blocks.length === 0) {
          finish(() => {
            markFailed(`Не удалось распарсить JSON из ответа Claude: ${output.slice(0, 300)}`);
            resolve(false);
          });
          return;
        }
        applyBlocks(projectId, blocks);
        const s = getProjectState(projectId);
        if (s) {
          s.generation_status = "done";
          s.generation_error = undefined;
          s.generation_tokens_in = usage.input + usage.cacheRead + usage.cacheWrite;
          s.generation_tokens_out = usage.output;
          s.generation_cost_usd = finalCostUsd ?? computeCost(usage);
          saveProjectState(projectId, s);
        }
        finish(() => resolve(true));
      });

      child.stdin.write(fullPrompt);
      child.stdin.end();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      markFailed(`Неожиданная ошибка: ${msg}`);
      resolve(false);
    }
  });
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
