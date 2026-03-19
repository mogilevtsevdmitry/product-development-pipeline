import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
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
    state.status = "stopped";
    state.current_gate = null;
    // Mark remaining agents as skipped
    for (const agent of Object.values(state.agents)) {
      if (agent.status === "pending") agent.status = "skipped";
    }
  } else if (decision === "pivot" || decision === "revise" || decision === "rollback") {
    // Rework — reset the "after" agents to re-run them
    const gateDef = GATES.find((g) => g.name === gate);
    if (gateDef) {
      for (const agentId of gateDef.after) {
        if (state.agents[agentId]) {
          state.agents[agentId].status = "pending";
          state.agents[agentId].started_at = null;
          state.agents[agentId].completed_at = null;
          state.agents[agentId].artifacts = [];
          state.agents[agentId].error = null;
        }
      }
    }
    // Remove gate decision so it can be re-triggered
    delete state.gate_decisions[gate];
    state.status = "running";
    state.current_gate = null;
  } else {
    // "go" — continue pipeline
    state.status = "running";
    state.current_gate = null;

    // After Gate 1 → expand pipeline graph with full agent set
    if (gate === "gate_1_build") {
      expandPipelineAfterGate1(state);
    }
  }

  state.updated_at = new Date().toISOString();

  const filePath = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  return true;
}

/**
 * After Gate 1: expand the pipeline graph.
 * Adds Pipeline Architect, BA, and dynamically determined agents.
 * For now adds the default full development pipeline.
 */
function expandPipelineAfterGate1(state: ProjectState): void {
  // Default full pipeline after gate 1
  const fullNodes = [
    "problem-researcher", "market-researcher", "product-owner",
    "pipeline-architect",
    "business-analyst", "legal-compliance",
    "ux-ui-designer",
    "system-architect",
    "tech-lead",
    "backend-developer", "frontend-developer",
    "devops-engineer",
    "qa-engineer", "security-engineer",
    "release-manager",
    "product-marketer", "smm-manager", "content-creator",
    "customer-support", "data-analyst",
  ];

  const fullEdges: [string, string][] = [
    // Static chain (already done)
    ["problem-researcher", "market-researcher"],
    ["market-researcher", "product-owner"],
    // After gate 1
    ["product-owner", "pipeline-architect"],
    ["pipeline-architect", "business-analyst"],
    // BA feeds into multiple
    ["business-analyst", "legal-compliance"],
    ["business-analyst", "ux-ui-designer"],
    ["business-analyst", "system-architect"],
    // Design + Architecture → Tech Lead (gate 2 before this)
    ["system-architect", "tech-lead"],
    ["ux-ui-designer", "tech-lead"],
    // Development
    ["tech-lead", "backend-developer"],
    ["tech-lead", "frontend-developer"],
    // QA/Security/DevOps need code
    ["backend-developer", "qa-engineer"],
    ["frontend-developer", "qa-engineer"],
    ["backend-developer", "security-engineer"],
    ["frontend-developer", "security-engineer"],
    ["backend-developer", "devops-engineer"],
    ["frontend-developer", "devops-engineer"],
    // Gate 3 before release
    ["qa-engineer", "release-manager"],
    ["security-engineer", "release-manager"],
    ["devops-engineer", "release-manager"],
    // Marketing (parallel branch from PO)
    ["product-owner", "product-marketer"],
    ["product-marketer", "smm-manager"],
    ["product-marketer", "content-creator"],
    // Feedback (after release)
    ["release-manager", "customer-support"],
    ["customer-support", "data-analyst"],
  ];

  state.pipeline_graph.nodes = fullNodes;
  state.pipeline_graph.edges = fullEdges;
  state.pipeline_graph.parallel_groups = [
    ["business-analyst", "legal-compliance"],
    ["backend-developer", "frontend-developer"],
    ["qa-engineer", "security-engineer", "devops-engineer"],
    ["smm-manager", "content-creator"],
  ];

  // Add state for new agents
  for (const nodeId of fullNodes) {
    if (!state.agents[nodeId]) {
      state.agents[nodeId] = {
        status: "pending",
        started_at: null,
        completed_at: null,
        artifacts: [],
        error: null,
      };
    }
  }
}

// ============================================================================
// Активация gate для завершённых проектов (фикс для старых проектов)
// ============================================================================

export function reactivateToGate(id: string): boolean {
  const state = getProjectState(id);
  if (!state) return false;

  // Проверяем, есть ли непройденный gate
  const gate = checkGates(state);
  if (gate) {
    state.status = "paused_at_gate";
    state.current_gate = gate;
    state.updated_at = new Date().toISOString();
    const fp = path.join(STATE_DIR, `${id}.json`);
    fs.writeFileSync(fp, JSON.stringify(state, null, 2), "utf-8");
    return true;
  }

  return false;
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
 * Найти агентов, готовых к запуску.
 * Условия: все зависимости completed + не заблокирован gate-точкой.
 */
function findReadyAgents(state: ProjectState): string[] {
  // Find agents blocked by unresolved gates
  const blockedByGate = new Set<string>();
  for (const gate of GATES) {
    if (state.gate_decisions[gate.name]) continue; // gate resolved
    // Check if gate should be active (all "after" agents completed)
    const afterInGraph = gate.after.filter((a) =>
      state.pipeline_graph.nodes.includes(a)
    );
    const allAfterDone = afterInGraph.length > 0 && afterInGraph.every(
      (a) => state.agents[a]?.status === "completed"
    );
    if (allAfterDone) {
      // Gate is active but not resolved — block "before" agents
      for (const b of gate.before) blockedByGate.add(b);
    }
  }

  const ready: string[] = [];
  for (const nodeId of state.pipeline_graph.nodes) {
    const agent = state.agents[nodeId];
    if (!agent || agent.status !== "pending") continue;
    if (blockedByGate.has(nodeId)) continue;

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
 * Собрать промпт, записать в файл, вернуть путь.
 */
function prepareAgentPrompt(
  agentId: string,
  state: ProjectState,
  outputDir: string
): string {
  const agentDir = path.join(AGENTS_DIR, AGENT_DIRS[agentId] || agentId);
  let systemPrompt = "";
  let rules = "";
  try { systemPrompt = fs.readFileSync(path.join(agentDir, "system-prompt.md"), "utf-8"); } catch { /* */ }
  try { rules = fs.readFileSync(path.join(agentDir, "rules.md"), "utf-8"); } catch { /* */ }

  const context = collectInputContext(agentId, state);

  const fullPrompt = [
    systemPrompt,
    rules ? `\n\n# Правила\n\n${rules}` : "",
    context ? `\n\n# Входные данные\n\n${context}` : "",
    `\n\n# Инструкции по сохранению\n\nСохрани все выходные артефакты в директорию: ${outputDir}\nФормат: Markdown (.md файлы).`,
  ].join("");

  const tmpFile = path.join(os.tmpdir(), `agent-prompt-${agentId}-${Date.now()}.md`);
  fs.writeFileSync(tmpFile, fullPrompt, "utf-8");
  return tmpFile;
}

/**
 * Собрать артефакты из директории агента.
 */
function collectArtifacts(outputDir: string, projectDir: string): string[] {
  const artifacts: string[] = [];
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md")) {
        artifacts.push(path.relative(projectDir, full));
      }
    }
  }
  walk(outputDir);
  return artifacts;
}

/**
 * Gate definitions: after which agents → pause at which gate.
 */
const GATES: {
  name: string;
  after: string[];    // all these must be completed
  before: string[];   // these are blocked until gate is resolved
}[] = [
  {
    name: "gate_1_build",
    after: ["product-owner"],
    before: ["pipeline-architect"],
  },
  {
    name: "gate_2_architecture",
    after: ["system-architect", "ux-ui-designer"],
    before: ["tech-lead"],
  },
  {
    name: "gate_3_go_nogo",
    after: ["qa-engineer", "security-engineer", "devops-engineer"],
    before: ["release-manager"],
  },
];

/**
 * Check if any gate should be triggered given the current state.
 * Returns gate name if pipeline should pause, null otherwise.
 */
function checkGates(state: ProjectState): string | null {
  for (const gate of GATES) {
    // Skip if gate already decided
    if (state.gate_decisions[gate.name]) continue;

    // Check if all "after" agents are in the graph and completed
    const afterInGraph = gate.after.filter((a) =>
      state.pipeline_graph.nodes.includes(a)
    );
    if (afterInGraph.length === 0) continue;

    const allAfterDone = afterInGraph.every(
      (a) => state.agents[a]?.status === "completed"
    );
    if (!allAfterDone) continue;

    // Gate should trigger — after agents done, gate not yet decided
    return gate.name;
  }
  return null;
}

/**
 * Обновить state после завершения агента.
 */
function finalizeAgent(
  id: string,
  agentId: string,
  success: boolean,
  errorMsg?: string
): void {
  const state = getProjectState(id);
  if (!state) return;

  const phase = AGENT_PHASES[agentId] || "other";
  const outputDir = path.join(PROJECTS_DIR, id, phase, agentId);
  const projectDir = path.join(PROJECTS_DIR, id);

  if (success) {
    state.agents[agentId].status = "completed";
    state.agents[agentId].artifacts = collectArtifacts(outputDir, projectDir);
    state.agents[agentId].error = null;
  } else {
    state.agents[agentId].status = "failed";
    state.agents[agentId].error = errorMsg || "Неизвестная ошибка";
  }
  state.agents[agentId].completed_at = new Date().toISOString();
  state.updated_at = new Date().toISOString();

  if (!success) {
    state.status = "failed";
  } else {
    // Check gates BEFORE checking pipeline completion
    const gate = checkGates(state);
    if (gate) {
      state.status = "paused_at_gate";
      state.current_gate = gate;
    } else {
      // Check pipeline completion
      const allDone = state.pipeline_graph.nodes.every((n) => {
        const s = state.agents[n]?.status;
        return s === "completed" || s === "skipped";
      });
      if (allDone) state.status = "completed";
    }
  }

  const fp = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(fp, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Запуск следующего агента — НЕ БЛОКИРУЕТ.
 * Ставит агента в running, спавнит процесс в фоне, возвращает управление сразу.
 * Процесс по завершении обновляет state JSON.
 */
export function runNextAgent(id: string): {
  ok: boolean;
  agentId?: string;
  error?: string;
} {
  const state = getProjectState(id);
  if (!state) return { ok: false, error: "Проект не найден" };

  // Если уже есть running агент — не запускаем второго
  const alreadyRunning = Object.entries(state.agents).find(
    ([, a]) => a.status === "running"
  );
  if (alreadyRunning) {
    return { ok: true, agentId: alreadyRunning[0], error: `Агент ${alreadyRunning[0]} уже работает` };
  }

  if (state.status !== "running" && state.status !== "created" && state.status !== "paused") {
    return { ok: false, error: `Нельзя запускать агентов в статусе: ${state.status}` };
  }

  // Если created → переводим в running
  if (state.status === "created" || state.status === "paused") {
    state.status = "running";
  }

  const ready = findReadyAgents(state);
  if (ready.length === 0) {
    const allDone = state.pipeline_graph.nodes.every((n) => {
      const s = state.agents[n]?.status;
      return s === "completed" || s === "skipped";
    });
    if (allDone) {
      state.status = "completed";
      state.updated_at = new Date().toISOString();
      const fp = path.join(STATE_DIR, `${id}.json`);
      fs.writeFileSync(fp, JSON.stringify(state, null, 2), "utf-8");
      return { ok: true, error: "Пайплайн завершён" };
    }
    state.updated_at = new Date().toISOString();
    const fp = path.join(STATE_DIR, `${id}.json`);
    fs.writeFileSync(fp, JSON.stringify(state, null, 2), "utf-8");
    return { ok: false, error: "Нет готовых агентов (ожидают зависимости или gate)" };
  }

  const agentId = ready[0];
  const now = new Date().toISOString();

  // Mark running + save state BEFORE spawning
  state.agents[agentId].status = "running";
  state.agents[agentId].started_at = now;
  state.agents[agentId].error = null;
  state.updated_at = now;
  const stateFile = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf-8");

  // Prepare prompt file + output dir
  const phase = AGENT_PHASES[agentId] || "other";
  const outputDir = path.join(PROJECTS_DIR, id, phase, agentId);
  fs.mkdirSync(outputDir, { recursive: true });
  const tmpFile = prepareAgentPrompt(agentId, state, outputDir);

  // Spawn Claude in background — does NOT block the API
  const child = spawn(
    "/bin/sh",
    ["-c", `cat "${tmpFile}" | claude --print --dangerously-skip-permissions`],
    {
      cwd: outputDir,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    }
  );

  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  child.on("close", (code) => {
    // Cleanup temp file
    try { fs.unlinkSync(tmpFile); } catch { /* */ }

    if (code === 0) {
      finalizeAgent(id, agentId, true);
    } else {
      finalizeAgent(id, agentId, false, stderr || `Процесс завершился с кодом ${code}`);
    }
  });

  child.on("error", (err) => {
    try { fs.unlinkSync(tmpFile); } catch { /* */ }
    finalizeAgent(id, agentId, false, err.message);
  });

  // Не ждём — возвращаем управление сразу
  return { ok: true, agentId };
}

/**
 * Запустить пайплайн.
 * В auto — ставит статус running, запускает первого агента.
 * Следующие агенты запускаются через polling (UI нажимает run_next или авто).
 */
export function startPipeline(id: string): {
  ok: boolean;
  agentId?: string;
  error?: string;
} {
  const state = getProjectState(id);
  if (!state) return { ok: false, error: "Проект не найден" };

  if (state.status === "created" || state.status === "paused") {
    state.status = "running";
    state.updated_at = new Date().toISOString();
    const fp = path.join(STATE_DIR, `${id}.json`);
    fs.writeFileSync(fp, JSON.stringify(state, null, 2), "utf-8");
  }

  // Запускаем первого готового агента
  return runNextAgent(id);
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
