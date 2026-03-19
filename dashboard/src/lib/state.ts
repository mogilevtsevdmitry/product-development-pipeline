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
 * After Gate 1: add only pipeline-architect.
 * The full graph will be built after PA completes based on its output.
 */
function expandPipelineAfterGate1(state: ProjectState): void {
  // Add only pipeline-architect node + edge from PO
  if (!state.pipeline_graph.nodes.includes("pipeline-architect")) {
    state.pipeline_graph.nodes.push("pipeline-architect");
  }
  const hasEdge = state.pipeline_graph.edges.some(
    ([s, t]) => s === "product-owner" && t === "pipeline-architect"
  );
  if (!hasEdge) {
    state.pipeline_graph.edges.push(["product-owner", "pipeline-architect"]);
  }
  if (!state.agents["pipeline-architect"]) {
    state.agents["pipeline-architect"] = {
      status: "pending",
      started_at: null,
      completed_at: null,
      artifacts: [],
      error: null,
    };
  }
}

/**
 * After Pipeline Architect completes: read its artifact,
 * parse the recommended agents, and build the actual graph.
 * Falls back to full graph if parsing fails.
 */
function expandPipelineFromArchitect(
  state: ProjectState,
  projectId: string
): void {
  // Try to read PA's output and extract agent list
  const paPhase = AGENT_PHASES["pipeline-architect"] || "meta";
  const paOutputDir = path.join(PROJECTS_DIR, projectId, paPhase, "pipeline-architect");
  let paOutput = "";

  if (fs.existsSync(paOutputDir)) {
    for (const file of fs.readdirSync(paOutputDir)) {
      if (file.endsWith(".md") && !file.startsWith("_")) {
        paOutput += fs.readFileSync(path.join(paOutputDir, file), "utf-8");
      }
    }
  }

  // Try to find JSON graph in PA output
  let parsedGraph: { nodes?: string[]; edges?: [string, string][] } | null = null;

  // Look for JSON block in markdown
  const jsonMatch = paOutput.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.nodes && Array.isArray(parsed.nodes)) {
        parsedGraph = parsed;
      }
    } catch { /* not valid JSON */ }
  }

  // Also try: look for agent IDs mentioned in the output
  const ALL_AGENT_IDS = Object.keys(AGENT_DIRS);
  const mentionedAgents = ALL_AGENT_IDS.filter((id) =>
    paOutput.includes(id) && id !== "pipeline-architect" && id !== "orchestrator"
  );

  if (parsedGraph && parsedGraph.nodes && parsedGraph.nodes.length > 0) {
    // Use PA's graph directly
    applyParsedGraph(state, parsedGraph.nodes, parsedGraph.edges || []);
  } else if (mentionedAgents.length >= 3) {
    // Build graph from mentioned agents
    buildGraphFromAgentList(state, mentionedAgents);
  } else {
    // Fallback: full graph
    buildGraphFromAgentList(state, ALL_AGENT_IDS.filter(
      (id) => id !== "orchestrator"
    ));
  }
}

/**
 * Apply a parsed graph from PA output.
 */
function applyParsedGraph(
  state: ProjectState,
  nodes: string[],
  edges: [string, string][]
): void {
  // Filter out disabled agents
  const disabled = getDisabledAgents();
  nodes = nodes.filter((n) => !disabled.has(n));
  edges = edges.filter(([s, t]) => !disabled.has(s) && !disabled.has(t));

  // Always keep static chain + pipeline-architect
  const keepNodes = new Set([
    "problem-researcher", "market-researcher", "product-owner",
    "pipeline-architect", ...nodes,
  ]);

  state.pipeline_graph.nodes = Array.from(keepNodes);
  state.pipeline_graph.edges = [
    ["problem-researcher", "market-researcher"],
    ["market-researcher", "product-owner"],
    ["product-owner", "pipeline-architect"],
    ...edges,
  ];

  // Add state for new agents
  for (const nodeId of state.pipeline_graph.nodes) {
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

/**
 * Build graph from a list of agent IDs using default dependency rules.
 */
function buildGraphFromAgentList(
  state: ProjectState,
  agents: string[]
): void {
  // Filter out disabled agents
  const disabled = getDisabledAgents();
  agents = agents.filter((a) => !disabled.has(a));

  const has = (id: string) => agents.includes(id);
  const nodes = new Set([
    "problem-researcher", "market-researcher", "product-owner",
    "pipeline-architect", ...agents,
  ]);

  const edges: [string, string][] = [
    ["problem-researcher", "market-researcher"],
    ["market-researcher", "product-owner"],
    ["product-owner", "pipeline-architect"],
  ];

  // Pipeline Architect → BA (always if BA present)
  if (has("business-analyst")) {
    edges.push(["pipeline-architect", "business-analyst"]);
  }

  // BA → Legal, Designer, Architect
  if (has("business-analyst") && has("legal-compliance"))
    edges.push(["business-analyst", "legal-compliance"]);
  if (has("business-analyst") && has("ux-ui-designer"))
    edges.push(["business-analyst", "ux-ui-designer"]);
  if (has("business-analyst") && has("system-architect"))
    edges.push(["business-analyst", "system-architect"]);

  // Architect + Designer → Tech Lead
  if (has("system-architect") && has("tech-lead"))
    edges.push(["system-architect", "tech-lead"]);
  if (has("ux-ui-designer") && has("tech-lead"))
    edges.push(["ux-ui-designer", "tech-lead"]);

  // Tech Lead → Backend, Frontend
  if (has("tech-lead") && has("backend-developer"))
    edges.push(["tech-lead", "backend-developer"]);
  if (has("tech-lead") && has("frontend-developer"))
    edges.push(["tech-lead", "frontend-developer"]);

  // Code → QA, Security, DevOps
  for (const dev of ["backend-developer", "frontend-developer"]) {
    if (!has(dev)) continue;
    for (const qa of ["qa-engineer", "security-engineer", "devops-engineer"]) {
      if (has(qa)) edges.push([dev, qa]);
    }
  }

  // QA/Security/DevOps → Release Manager
  for (const qa of ["qa-engineer", "security-engineer", "devops-engineer"]) {
    if (has(qa) && has("release-manager"))
      edges.push([qa, "release-manager"]);
  }

  // Marketing from PO
  if (has("product-marketer"))
    edges.push(["product-owner", "product-marketer"]);
  if (has("product-marketer") && has("smm-manager"))
    edges.push(["product-marketer", "smm-manager"]);
  if (has("product-marketer") && has("content-creator"))
    edges.push(["product-marketer", "content-creator"]);

  // Feedback after release
  if (has("release-manager") && has("customer-support"))
    edges.push(["release-manager", "customer-support"]);
  if (has("customer-support") && has("data-analyst"))
    edges.push(["customer-support", "data-analyst"]);
  if (has("content-creator") && has("data-analyst"))
    edges.push(["content-creator", "data-analyst"]);

  state.pipeline_graph.nodes = Array.from(nodes);
  state.pipeline_graph.edges = edges;

  // Build parallel groups from present agents
  const pGroups: string[][] = [];
  const devPair = ["backend-developer", "frontend-developer"].filter(has);
  if (devPair.length > 1) pGroups.push(devPair);
  const qaPair = ["qa-engineer", "security-engineer", "devops-engineer"].filter(has);
  if (qaPair.length > 1) pGroups.push(qaPair);
  const mktPair = ["smm-manager", "content-creator"].filter(has);
  if (mktPair.length > 1) pGroups.push(mktPair);
  state.pipeline_graph.parallel_groups = pGroups;

  // Add state for new agents
  for (const nodeId of state.pipeline_graph.nodes) {
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

  if (state.status === "stopped" || state.status === "failed" || state.status === "completed") {
    // Reactivate: un-skip agents that were skipped, set to running
    for (const agent of Object.values(state.agents)) {
      if (agent.status === "skipped") {
        agent.status = "pending";
      }
    }
    // Check if there's an unresolved gate
    const gate = checkGates(state);
    if (gate) {
      state.status = "paused_at_gate";
      state.current_gate = gate;
    } else {
      state.status = "running";
      state.current_gate = null;
    }
    state.updated_at = new Date().toISOString();
    const filePath = path.join(STATE_DIR, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
    return true;
  }

  if (state.status === "paused" || state.status === "paused_at_gate") {
    state.status = "running";
    state.current_gate = null;
    state.updated_at = new Date().toISOString();
    const filePath = path.join(STATE_DIR, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
    return true;
  }

  return false;
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
const AGENTS_CONFIG_PATH = path.join(AGENTS_DIR, "agents-config.json");

/**
 * Read disabled agent IDs from agents-config.json.
 */
function getDisabledAgents(): Set<string> {
  if (!fs.existsSync(AGENTS_CONFIG_PATH)) return new Set();
  try {
    const config = JSON.parse(fs.readFileSync(AGENTS_CONFIG_PATH, "utf-8"));
    return new Set(
      Object.entries(config)
        .filter(([, v]) => (v as { enabled?: boolean }).enabled === false)
        .map(([k]) => k)
    );
  } catch {
    return new Set();
  }
}

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

  // Max context size per artifact and total
  const MAX_PER_ARTIFACT = 15_000; // 15K chars per file
  const MAX_TOTAL = 80_000; // 80K chars total context
  let totalSize = 0;

  for (const dep of deps) {
    const depAgent = state.agents[dep];
    if (depAgent?.status !== "completed") continue;

    // Prefer *-output.md (agent's own report), skip raw code/data files
    const outputArtifacts = depAgent.artifacts.filter(
      (a) => a.endsWith("-output.md") || a.endsWith("README.md")
    );
    const otherArtifacts = depAgent.artifacts.filter(
      (a) => !a.endsWith("-output.md") && !a.endsWith("README.md")
    );

    // Primary: agent output reports (always include)
    for (const artifactPath of outputArtifacts) {
      if (totalSize >= MAX_TOTAL) break;
      const fullPath = path.join(projectDir, artifactPath);
      if (!fs.existsSync(fullPath)) continue;
      let content = fs.readFileSync(fullPath, "utf-8");
      if (content.length > MAX_PER_ARTIFACT) {
        content = content.slice(0, MAX_PER_ARTIFACT) + "\n\n... [обрезано, файл слишком большой] ...";
      }
      parts.push(`--- Артефакт от ${dep}: ${artifactPath} ---\n${content}\n`);
      totalSize += content.length;
    }

    // Secondary: other artifacts (include if space allows)
    for (const artifactPath of otherArtifacts) {
      if (totalSize >= MAX_TOTAL) break;
      const fullPath = path.join(projectDir, artifactPath);
      if (!fs.existsSync(fullPath)) continue;
      const stat = fs.statSync(fullPath);

      // Skip large files — provide summary instead
      if (stat.size > MAX_PER_ARTIFACT) {
        parts.push(
          `--- Артефакт от ${dep}: ${artifactPath} (${Math.round(stat.size / 1024)}KB) ---\n` +
          `[Файл слишком большой для включения. Путь: ${fullPath}]\n`
        );
        totalSize += 200;
        continue;
      }

      const content = fs.readFileSync(fullPath, "utf-8");
      parts.push(`--- Артефакт от ${dep}: ${artifactPath} ---\n${content}\n`);
      totalSize += content.length;
    }

    // If no artifacts but agent completed — add a note
    if (depAgent.artifacts.length === 0) {
      parts.push(`--- ${dep}: завершён, артефактов нет ---\n`);
    }
  }

  // For first agent — pass project description
  if (deps.length === 0 && state.description) {
    parts.push(`--- Описание проекта ---\n${state.description}\n`);
  }

  // If we hit the limit, add a note
  if (totalSize >= MAX_TOTAL) {
    parts.push(
      "\n--- ВНИМАНИЕ: контекст обрезан из-за ограничения размера. " +
      "Работай с предоставленными данными. ---\n"
    );
  }

  // Add project file tree for agents that need code context
  const codeAgents = new Set([
    "devops-engineer", "qa-engineer", "security-engineer",
    "release-manager",
  ]);
  if (codeAgents.has(agentId)) {
    const tree = getProjectTree(state.project_id);
    if (tree) {
      parts.push(`\n--- Структура проекта ---\n${tree}\n`);
    }
  }

  return parts.join("\n");
}

/**
 * Get a compact file tree of the project (excluding node_modules etc).
 */
function getProjectTree(projectId: string, maxDepth = 4): string {
  const projectDir = path.join(PROJECTS_DIR, projectId);
  if (!fs.existsSync(projectDir)) return "";

  const lines: string[] = [];
  function walk(dir: string, prefix: string, depth: number) {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }

    // Filter and sort
    entries = entries
      .filter((e) => !SKIP_DIRS.has(e.name) && !e.name.startsWith("."))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    // Limit entries per directory
    const shown = entries.slice(0, 30);
    const hidden = entries.length - shown.length;

    for (const entry of shown) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        walk(full, prefix + "  ", depth + 1);
      } else {
        const stat = fs.statSync(full);
        const sizeStr = stat.size > 1024
          ? `${Math.round(stat.size / 1024)}KB`
          : `${stat.size}B`;
        lines.push(`${prefix}${entry.name} (${sizeStr})`);
      }
    }
    if (hidden > 0) {
      lines.push(`${prefix}... ещё ${hidden} файлов`);
    }
  }

  walk(projectDir, "", 0);
  return lines.join("\n");
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
    `\n\n# Инструкции\n\nВыполни задачу и верни результат в формате Markdown. Весь твой вывод будет сохранён как артефакт. Не пиши ничего лишнего — только структурированный отчёт.`,
  ].join("");

  const tmpFile = path.join(os.tmpdir(), `agent-prompt-${agentId}-${Date.now()}.md`);
  fs.writeFileSync(tmpFile, fullPrompt, "utf-8");
  return tmpFile;
}

/**
 * Собрать артефакты из директории агента.
 */
const SKIP_DIRS = new Set([
  "node_modules", ".next", ".git", "__pycache__", ".venv",
  "venv", "dist", "build", ".cache", ".turbo",
]);

function collectArtifacts(outputDir: string, projectDir: string): string[] {
  const artifacts: string[] = [];
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md") && !entry.name.startsWith("_")) {
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

  // If agent was paused/reset while running — don't overwrite
  if (state.agents[agentId]?.status !== "running") return;

  const phase = AGENT_PHASES[agentId] || "other";
  const outputDir = path.join(PROJECTS_DIR, id, phase, agentId);
  const projectDir = path.join(PROJECTS_DIR, id);

  if (success) {
    state.agents[agentId].status = "completed";
    state.agents[agentId].artifacts = collectArtifacts(outputDir, projectDir);
    state.agents[agentId].error = null;

    // After Pipeline Architect completes → expand graph from its output
    if (agentId === "pipeline-architect") {
      expandPipelineFromArchitect(state, id);
    }
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
/**
 * Spawn a single agent in background. Does NOT block.
 */
function spawnAgent(id: string, agentId: string, state: ProjectState): void {
  const phase = AGENT_PHASES[agentId] || "other";
  const outputDir = path.join(PROJECTS_DIR, id, phase, agentId);
  fs.mkdirSync(outputDir, { recursive: true });
  const tmpFile = prepareAgentPrompt(agentId, state, outputDir);

  const child = spawn(
    "/bin/sh",
    ["-c", `cat "${tmpFile}" | claude --print --dangerously-skip-permissions`],
    {
      cwd: outputDir,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    }
  );

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

  child.on("close", (code) => {
    try { fs.unlinkSync(tmpFile); } catch { /* */ }
    if (code === 0 && stdout.trim()) {
      const outputFile = path.join(outputDir, `${agentId}-output.md`);
      fs.writeFileSync(outputFile, stdout.trim(), "utf-8");
      finalizeAgent(id, agentId, true);
    } else if (code === 0) {
      finalizeAgent(id, agentId, true);
    } else {
      const errorParts: string[] = [];
      if (stderr.trim()) errorParts.push(stderr.trim());
      if (stdout.trim()) errorParts.push(stdout.trim());
      const errorMsg = errorParts.join("\n\n") || `Процесс завершился с кодом ${code}`;
      // Truncate to avoid huge error messages
      finalizeAgent(id, agentId, false, errorMsg.slice(0, 3000));
    }
  });

  child.on("error", (err) => {
    try { fs.unlinkSync(tmpFile); } catch { /* */ }
    finalizeAgent(id, agentId, false, err.message);
  });
}

/**
 * Launch ALL ready agents in parallel. Non-blocking.
 */
export function runNextAgent(id: string): {
  ok: boolean;
  agentId?: string;
  launched?: string[];
  error?: string;
} {
  const state = getProjectState(id);
  if (!state) return { ok: false, error: "Проект не найден" };

  if (state.status !== "running" && state.status !== "created" && state.status !== "paused") {
    return { ok: false, error: `Нельзя запускать агентов в статусе: ${state.status}` };
  }

  if (state.status === "created" || state.status === "paused") {
    state.status = "running";
  }

  const ready = findReadyAgents(state);
  if (ready.length === 0) {
    // Check if there are running agents (wait for them)
    const hasRunning = Object.values(state.agents).some(a => a.status === "running");
    if (hasRunning) {
      state.updated_at = new Date().toISOString();
      const fp = path.join(STATE_DIR, `${id}.json`);
      fs.writeFileSync(fp, JSON.stringify(state, null, 2), "utf-8");
      return { ok: true, error: "Агенты уже работают, ожидаем завершения" };
    }

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

  const now = new Date().toISOString();

  // Mark ALL ready agents as running + save state BEFORE spawning
  for (const agentId of ready) {
    state.agents[agentId].status = "running";
    state.agents[agentId].started_at = now;
    state.agents[agentId].error = null;
  }
  state.updated_at = now;
  const stateFile = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf-8");

  // Spawn ALL ready agents in parallel
  for (const agentId of ready) {
    spawnAgent(id, agentId, state);
  }

  return { ok: true, agentId: ready[0], launched: ready };
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
// Управление отдельным агентом
// ============================================================================

export function restartAgent(id: string, agentId: string): boolean {
  const state = getProjectState(id);
  if (!state) return false;

  const agent = state.agents[agentId];
  if (!agent) return false;

  agent.status = "pending";
  agent.started_at = null;
  agent.completed_at = null;
  agent.artifacts = [];
  agent.error = null;

  if (state.status === "failed" || state.status === "stopped") {
    state.status = "running";
  }

  state.updated_at = new Date().toISOString();
  const filePath = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  return true;
}

/**
 * Pause a single running agent — sets it back to pending.
 * The background process will still finish, but finalizeAgent
 * will see status != running and skip the update.
 */
export function pauseAgent(id: string, agentId: string): boolean {
  const state = getProjectState(id);
  if (!state) return false;
  const agent = state.agents[agentId];
  if (!agent || agent.status !== "running") return false;

  agent.status = "pending";
  agent.started_at = null;
  agent.error = "Остановлен вручную";
  state.updated_at = new Date().toISOString();

  const fp = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(fp, JSON.stringify(state, null, 2), "utf-8");
  return true;
}

/**
 * Run a specific agent by ID (not just "next ready").
 */
export function runSpecificAgent(id: string, agentId: string): {
  ok: boolean;
  error?: string;
} {
  const state = getProjectState(id);
  if (!state) return { ok: false, error: "Проект не найден" };
  const agent = state.agents[agentId];
  if (!agent) return { ok: false, error: "Агент не найден" };
  if (agent.status === "running") return { ok: true, error: "Уже работает" };
  if (agent.status === "completed") return { ok: false, error: "Уже завершён" };

  // Reset if needed
  agent.status = "running";
  agent.started_at = new Date().toISOString();
  agent.error = null;
  if (state.status !== "running") state.status = "running";
  state.updated_at = new Date().toISOString();

  const fp = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(fp, JSON.stringify(state, null, 2), "utf-8");

  spawnAgent(id, agentId, state);
  return { ok: true };
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
