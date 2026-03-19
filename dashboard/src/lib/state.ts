import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import type { ProjectState, GateType, GateDecisionValue } from "./types";

const STATE_DIR = path.resolve(
  process.cwd(),
  "..",
  "orchestrator",
  "state"
);

const PROJECTS_DIR = path.resolve(
  process.cwd(),
  "..",
  "projects"
);

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ============================================================================
// Чтение состояния
// ============================================================================

export function getProjectState(id: string): ProjectState | null {
  ensureDir(STATE_DIR);
  const filePath = path.join(STATE_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as ProjectState;
}

export interface ProjectSummary {
  project_id: string;
  name: string;
  description: string;
  status: string;
  mode: string;
  created_at: string;
  updated_at: string;
  current_gate: string | null;
  agents_total: number;
  agents_completed: number;
}

export function listProjects(): ProjectSummary[] {
  ensureDir(STATE_DIR);
  const files = fs.readdirSync(STATE_DIR).filter((f) => f.endsWith(".json"));
  const projects: ProjectSummary[] = [];

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(STATE_DIR, file), "utf-8");
      const state = JSON.parse(raw) as ProjectState;
      const agents = Object.values(state.agents || {});
      projects.push({
        project_id: state.project_id,
        name: state.name,
        description: state.description || "",
        status: state.status,
        mode: state.mode,
        created_at: state.created_at,
        updated_at: state.updated_at,
        current_gate: state.current_gate,
        agents_total: agents.length,
        agents_completed: agents.filter((a) => a.status === "completed").length,
      });
    } catch {
      // skip malformed files
    }
  }

  return projects.sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
}

// ============================================================================
// Создание проекта
// ============================================================================

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[-\s]+/g, "-")
    .replace(/^-+|-+$/g, "") || `project-${Date.now()}`;
}

const STATIC_CHAIN = [
  "problem-researcher",
  "market-researcher",
  "product-owner",
];

export function createProject(
  name: string,
  description: string,
  mode: "auto" | "human_approval" = "auto"
): ProjectState {
  ensureDir(STATE_DIR);
  ensureDir(PROJECTS_DIR);

  const projectId = slugify(name);
  const timestamp = new Date().toISOString();

  // Создаём папку проекта
  const projectDir = path.join(PROJECTS_DIR, projectId);
  ensureDir(projectDir);

  // Начальное состояние — только статическая цепочка
  const agentsState: Record<string, { status: string; started_at: null; completed_at: null; artifacts: string[]; error: null }> = {};
  for (const agentId of STATIC_CHAIN) {
    agentsState[agentId] = {
      status: "pending",
      started_at: null,
      completed_at: null,
      artifacts: [],
      error: null,
    };
  }

  const state: ProjectState = {
    project_id: projectId,
    name,
    description,
    created_at: timestamp,
    updated_at: timestamp,
    mode,
    status: "created",
    current_gate: null,
    pipeline_graph: {
      nodes: [...STATIC_CHAIN],
      edges: [
        ["problem-researcher", "market-researcher"],
        ["market-researcher", "product-owner"],
      ],
      parallel_groups: [],
    },
    agents: agentsState,
    gate_decisions: {},
    schema_version: 1,
  };

  // Сохраняем state JSON
  const filePath = path.join(STATE_DIR, `${projectId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");

  return state;
}

// ============================================================================
// Gate-решения
// ============================================================================

export function resolveGate(
  id: string,
  gate: GateType,
  decision: GateDecisionValue,
  notes?: string
): boolean {
  const state = getProjectState(id);
  if (!state) return false;

  state.gate_decisions[gate] = {
    decision,
    decided_by: "human",
    timestamp: new Date().toISOString(),
    notes,
  };

  if (decision === "stop" || decision === "no-go") {
    state.status = "failed";
    state.current_gate = null;
  } else {
    state.status = "running";
    state.current_gate = null;
  }

  state.updated_at = new Date().toISOString();

  const filePath = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  return true;
}

// ============================================================================
// Переключение режима
// ============================================================================

export function switchMode(
  id: string,
  mode: "auto" | "human_approval"
): boolean {
  const state = getProjectState(id);
  if (!state) return false;

  state.mode = mode;
  state.updated_at = new Date().toISOString();

  const filePath = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  return true;
}

// ============================================================================
// Пауза
// ============================================================================

export function pauseProject(id: string): boolean {
  const state = getProjectState(id);
  if (!state) return false;
  if (state.status !== "running") return false;

  state.status = "paused";
  state.updated_at = new Date().toISOString();

  const filePath = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  return true;
}

// ============================================================================
// Возобновление
// ============================================================================

export function resumeProject(id: string): boolean {
  const state = getProjectState(id);
  if (!state) return false;
  if (state.status !== "paused" && state.status !== "paused_at_gate") return false;

  state.status = "running";
  state.current_gate = null;
  state.updated_at = new Date().toISOString();

  const filePath = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  return true;
}

// ============================================================================
// Остановка (необратимая)
// ============================================================================

export function stopProject(id: string): boolean {
  const state = getProjectState(id);
  if (!state) return false;
  if (state.status === "completed" || state.status === "stopped") return false;

  state.status = "stopped";
  state.current_gate = null;
  state.updated_at = new Date().toISOString();

  // Помечаем все running/pending агенты как skipped
  for (const agent of Object.values(state.agents)) {
    if (agent.status === "running" || agent.status === "pending") {
      agent.status = "skipped";
    }
  }

  const filePath = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  return true;
}

// ============================================================================
// Удаление проекта
// ============================================================================

// ============================================================================
// Запуск пайплайна
// ============================================================================

const AGENTS_DIR = path.resolve(process.cwd(), "..", "agents");

const AGENT_DIRS: Record<string, string> = {
  "problem-researcher": "research/problem-researcher",
  "market-researcher": "research/market-researcher",
  "product-owner": "product/product-owner",
  "pipeline-architect": "meta/pipeline-architect",
  "business-analyst": "product/business-analyst",
  "legal-compliance": "legal/legal-compliance",
  "ux-ui-designer": "design/ux-ui-designer",
  "system-architect": "development/system-architect",
  "tech-lead": "development/tech-lead",
  "backend-developer": "development/backend-developer",
  "frontend-developer": "development/frontend-developer",
  "devops-engineer": "development/devops-engineer",
  "qa-engineer": "quality/qa-engineer",
  "security-engineer": "quality/security-engineer",
  "release-manager": "release/release-manager",
  "product-marketer": "marketing/product-marketer",
  "smm-manager": "marketing/smm-manager",
  "content-creator": "marketing/content-creator",
  "customer-support": "feedback/customer-support",
  "data-analyst": "feedback/data-analyst",
  orchestrator: "meta/orchestrator",
};

const AGENT_PHASES: Record<string, string> = {
  "problem-researcher": "research",
  "market-researcher": "research",
  "product-owner": "product",
  "pipeline-architect": "meta",
  "business-analyst": "product",
  "legal-compliance": "legal",
  "ux-ui-designer": "design",
  "system-architect": "development",
  "tech-lead": "development",
  "backend-developer": "development",
  "frontend-developer": "development",
  "devops-engineer": "development",
  "qa-engineer": "quality",
  "security-engineer": "quality",
  "release-manager": "release",
  "product-marketer": "marketing",
  "smm-manager": "marketing",
  "content-creator": "marketing",
  "customer-support": "feedback",
  "data-analyst": "feedback",
  orchestrator: "meta",
};

/**
 * Найти агентов, готовых к запуску (все зависимости completed).
 */
function findReadyAgents(state: ProjectState): string[] {
  const ready: string[] = [];
  for (const nodeId of state.pipeline_graph.nodes) {
    const agent = state.agents[nodeId];
    if (!agent || agent.status !== "pending") continue;

    const deps = state.pipeline_graph.edges
      .filter(([, tgt]) => tgt === nodeId)
      .map(([src]) => src);

    const allDone = deps.every(
      (d) => state.agents[d]?.status === "completed"
    );
    if (allDone) ready.push(nodeId);
  }
  return ready;
}

/**
 * Собрать входной контекст из артефактов зависимостей.
 */
function collectInputContext(
  agentId: string,
  state: ProjectState
): string {
  const deps = state.pipeline_graph.edges
    .filter(([, tgt]) => tgt === agentId)
    .map(([src]) => src);

  const parts: string[] = [];
  const projectDir = path.join(PROJECTS_DIR, state.project_id);

  for (const dep of deps) {
    const depAgent = state.agents[dep];
    if (depAgent?.status !== "completed") continue;
    for (const artifactPath of depAgent.artifacts) {
      const fullPath = path.join(projectDir, artifactPath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        parts.push(`--- Артефакт: ${artifactPath} ---\n${content}\n`);
      }
    }
  }

  // Для первого агента передаём описание проекта
  if (deps.length === 0 && state.description) {
    parts.push(`--- Описание проекта ---\n${state.description}\n`);
  }

  return parts.join("\n");
}

/**
 * Запуск одного агента через Claude CLI.
 */
export function runNextAgent(id: string): {
  ok: boolean;
  agentId?: string;
  error?: string;
} {
  const state = getProjectState(id);
  if (!state) return { ok: false, error: "Проект не найден" };
  if (state.status !== "running" && state.status !== "created") {
    return { ok: false, error: `Нельзя запускать агентов в статусе: ${state.status}` };
  }

  // Если created → переводим в running
  if (state.status === "created") {
    state.status = "running";
  }

  const ready = findReadyAgents(state);
  if (ready.length === 0) {
    // Проверяем, завершён ли пайплайн
    const allDone = state.pipeline_graph.nodes.every(
      (n) => {
        const s = state.agents[n]?.status;
        return s === "completed" || s === "skipped";
      }
    );
    if (allDone) {
      state.status = "completed";
      state.updated_at = new Date().toISOString();
      const fp = path.join(STATE_DIR, `${id}.json`);
      fs.writeFileSync(fp, JSON.stringify(state, null, 2), "utf-8");
      return { ok: true, agentId: undefined, error: "Пайплайн завершён" };
    }
    return { ok: false, error: "Нет готовых агентов (ожидают зависимости или gate)" };
  }

  const agentId = ready[0];
  const now = new Date().toISOString();

  // Mark running
  state.agents[agentId].status = "running";
  state.agents[agentId].started_at = now;
  state.updated_at = now;
  const stateFile = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf-8");

  // Load prompts
  const agentDir = path.join(AGENTS_DIR, AGENT_DIRS[agentId] || agentId);
  let systemPrompt = "";
  let rules = "";
  try {
    systemPrompt = fs.readFileSync(path.join(agentDir, "system-prompt.md"), "utf-8");
  } catch { /* skip */ }
  try {
    rules = fs.readFileSync(path.join(agentDir, "rules.md"), "utf-8");
  } catch { /* skip */ }

  const context = collectInputContext(agentId, state);

  // Output dir
  const phase = AGENT_PHASES[agentId] || "other";
  const outputDir = path.join(PROJECTS_DIR, id, phase, agentId);
  fs.mkdirSync(outputDir, { recursive: true });

  // Build prompt
  const fullPrompt = [
    systemPrompt,
    rules ? `\n\n# Правила\n\n${rules}` : "",
    context ? `\n\n# Входные данные\n\n${context}` : "",
    `\n\n# Инструкции по сохранению\n\nСохрани все выходные артефакты в директорию: ${outputDir}\nФормат: Markdown (.md файлы).`,
  ].join("");

  // Write prompt to temp file to avoid shell escaping issues
  const tmpFile = path.join(os.tmpdir(), `agent-prompt-${agentId}-${Date.now()}.md`);
  fs.writeFileSync(tmpFile, fullPrompt, "utf-8");

  try {
    execFileSync(
      "claude",
      [
        "--print",
        "--dangerously-skip-permissions",
        "-p",
        fullPrompt,
      ],
      {
        cwd: outputDir,
        timeout: 600_000,
        stdio: "pipe",
        maxBuffer: 50 * 1024 * 1024, // 50MB
      }
    );
  } catch (err) {
    // Clean up temp file
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    // Agent failed
    const reloadedState = getProjectState(id)!;
    reloadedState.agents[agentId].status = "failed";
    reloadedState.agents[agentId].completed_at = new Date().toISOString();
    reloadedState.agents[agentId].error = err instanceof Error ? err.message : String(err);
    reloadedState.updated_at = new Date().toISOString();
    fs.writeFileSync(stateFile, JSON.stringify(reloadedState, null, 2), "utf-8");
    return { ok: false, agentId, error: `Агент ${agentId} завершился с ошибкой` };
  }

  // Clean up temp file
  try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

  // Collect output artifacts
  const artifacts: string[] = [];
  const projectDir = path.join(PROJECTS_DIR, id);
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (entry.name.endsWith(".md")) {
        artifacts.push(path.relative(projectDir, path.join(dir, entry.name)));
      }
    }
  }
  walk(outputDir);

  // Update state
  const finalState = getProjectState(id)!;
  finalState.agents[agentId].status = "completed";
  finalState.agents[agentId].completed_at = new Date().toISOString();
  finalState.agents[agentId].artifacts = artifacts;
  finalState.agents[agentId].error = null;
  finalState.updated_at = new Date().toISOString();

  // Check if pipeline is complete
  const allDone = finalState.pipeline_graph.nodes.every(
    (n) => {
      const s = finalState.agents[n]?.status;
      return s === "completed" || s === "skipped";
    }
  );
  if (allDone) {
    finalState.status = "completed";
  }

  fs.writeFileSync(stateFile, JSON.stringify(finalState, null, 2), "utf-8");
  return { ok: true, agentId };
}

/**
 * Запустить все готовые агенты по цепочке (auto-режим).
 * Запускает по одному, пока есть готовые.
 */
export function startPipeline(id: string): {
  ok: boolean;
  ran: string[];
  error?: string;
} {
  const state = getProjectState(id);
  if (!state) return { ok: false, ran: [], error: "Проект не найден" };

  if (state.status === "created") {
    state.status = "running";
    state.updated_at = new Date().toISOString();
    const fp = path.join(STATE_DIR, `${id}.json`);
    fs.writeFileSync(fp, JSON.stringify(state, null, 2), "utf-8");
  }

  const ran: string[] = [];

  while (true) {
    const current = getProjectState(id);
    if (!current) break;
    if (current.status !== "running") break;

    const ready = findReadyAgents(current);
    if (ready.length === 0) break;

    const result = runNextAgent(id);
    if (result.agentId) ran.push(result.agentId);
    if (!result.ok) break;

    // В human_approval режиме — остановка после каждого
    if (current.mode === "human_approval") {
      const updated = getProjectState(id)!;
      updated.status = "paused";
      updated.updated_at = new Date().toISOString();
      const fp = path.join(STATE_DIR, `${id}.json`);
      fs.writeFileSync(fp, JSON.stringify(updated, null, 2), "utf-8");
      break;
    }
  }

  return { ok: true, ran };
}

// ============================================================================
// Перезапуск агента
// ============================================================================

export function restartAgent(id: string, agentId: string): boolean {
  const state = getProjectState(id);
  if (!state) return false;

  const agent = state.agents[agentId];
  if (!agent) return false;

  // Сбрасываем агента в pending
  agent.status = "pending";
  agent.started_at = null;
  agent.completed_at = null;
  agent.artifacts = [];
  agent.error = null;

  // Если проект был failed из-за этого агента — возвращаем в running
  if (state.status === "failed" || state.status === "stopped") {
    state.status = "running";
  }

  state.updated_at = new Date().toISOString();

  const filePath = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  return true;
}

// ============================================================================
// Удаление проекта
// ============================================================================

export function deleteProject(id: string): boolean {
  const stateFile = path.join(STATE_DIR, `${id}.json`);
  if (!fs.existsSync(stateFile)) return false;

  // Удаляем state JSON
  fs.unlinkSync(stateFile);

  // Удаляем папку проекта (артефакты)
  const projectDir = path.join(PROJECTS_DIR, id);
  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }

  return true;
}
