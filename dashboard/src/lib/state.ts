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

// Default blocks for new projects (matches Python orchestrator config.py)
const DEFAULT_BLOCKS: import("./types").PipelineBlock[] = [
  {
    id: "research",
    name: "Исследование",
    description: "Анализ проблемы, исследование рынка, формирование продуктового видения",
    agents: ["problem-researcher", "market-researcher", "product-owner", "business-analyst"],
    edges: [["problem-researcher", "market-researcher"], ["market-researcher", "product-owner"], ["product-owner", "business-analyst"]],
    requires_approval: true,
    depends_on: [],
  },
  {
    id: "legal",
    name: "Юридическое",
    description: "Проверка юридических и compliance требований",
    agents: ["legal-compliance"],
    edges: [],
    requires_approval: false,
    depends_on: ["research"],
  },
  {
    id: "design",
    name: "Дизайн",
    description: "Проектирование пользовательского интерфейса и опыта",
    agents: ["ux-ui-designer"],
    edges: [],
    requires_approval: false,
    depends_on: ["research"],
  },
  {
    id: "development",
    name: "Архитектура и разработка",
    description: "Проектирование архитектуры, планирование и реализация",
    agents: ["pipeline-architect", "system-architect", "tech-lead", "backend-developer", "frontend-developer", "devops-engineer"],
    edges: [["pipeline-architect", "system-architect"], ["system-architect", "tech-lead"], ["tech-lead", "backend-developer"], ["tech-lead", "frontend-developer"], ["tech-lead", "devops-engineer"]],
    requires_approval: true,
    depends_on: ["design", "legal"],
  },
  {
    id: "testing",
    name: "Тестирование",
    description: "Проверка качества и безопасности",
    agents: ["qa-engineer", "security-engineer"],
    edges: [],
    requires_approval: true,
    depends_on: ["development"],
  },
  {
    id: "release",
    name: "Релиз",
    description: "Подготовка и выпуск релиза",
    agents: ["release-manager"],
    edges: [],
    requires_approval: false,
    depends_on: ["testing"],
  },
  {
    id: "marketing",
    name: "Маркетинг",
    description: "Продвижение продукта, SMM, контент",
    agents: ["product-marketer", "smm-manager", "content-creator"],
    edges: [["product-marketer", "smm-manager"], ["product-marketer", "content-creator"]],
    requires_approval: false,
    depends_on: ["release"],
  },
  {
    id: "feedback",
    name: "Фидбек",
    description: "Поддержка пользователей и аналитика",
    agents: ["customer-support", "data-analyst"],
    edges: [],
    requires_approval: false,
    depends_on: ["release"],
  },
];

function migrateToV2(state: ProjectState): ProjectState {
  // Patch existing v2 blocks that are missing depends_on or cycle fields
  if (state.schema_version >= 2 && state.blocks?.length) {
    let patched = false;
    for (const block of state.blocks) {
      if (!block.depends_on) {
        const defaultMatch = DEFAULT_BLOCKS.find((db) => db.id === block.id);
        block.depends_on = defaultMatch?.depends_on || [];
        patched = true;
      }
    }
    if (!state.current_cycle) { state.current_cycle = 1; patched = true; }
    if (!state.cycle_history) { state.cycle_history = []; patched = true; }
    if (patched) state.schema_version = 2; // ensure
    return state;
  }

  // Build blocks from existing pipeline_graph by matching agents to default blocks
  const graphNodes = new Set(state.pipeline_graph?.nodes || []);
  const blocks: import("./types").PipelineBlock[] = [];

  for (const defaultBlock of DEFAULT_BLOCKS) {
    const blockAgents = defaultBlock.agents.filter((a) => graphNodes.has(a));
    if (blockAgents.length === 0) continue;

    const blockEdges = defaultBlock.edges.filter(
      ([s, t]) => blockAgents.includes(s) && blockAgents.includes(t)
    );

    // Migrate gate_decisions to block approval
    let approval: import("./types").BlockApproval | undefined;
    // Map old gates to blocks
    const gateMapping: Record<string, string> = {
      gate_1_build: "research",
      gate_2_architecture: "development",
      gate_3_go_nogo: "testing",
    };
    for (const [gateName, blockId] of Object.entries(gateMapping)) {
      if (blockId === defaultBlock.id && state.gate_decisions?.[gateName]) {
        const gd = state.gate_decisions[gateName]!;
        approval = {
          decision: gd.decision === "go" ? "go" : "stop",
          decided_by: gd.decided_by,
          timestamp: gd.timestamp,
          notes: gd.notes,
        };
      }
    }

    blocks.push({
      ...defaultBlock,
      agents: blockAgents,
      edges: blockEdges as [string, string][],
      ...(approval ? { approval } : {}),
    });
  }

  state.blocks = blocks;
  state.schema_version = 2;
  if (!state.current_cycle) state.current_cycle = 1;
  if (!state.cycle_history) state.cycle_history = [];

  // Ensure all blocks have depends_on (upgrade from early v2 without it)
  for (const block of state.blocks) {
    if (!block.depends_on) {
      const defaultMatch = DEFAULT_BLOCKS.find((db) => db.id === block.id);
      block.depends_on = defaultMatch?.depends_on || [];
    }
  }

  return state;
}

// ============================================================================
// Чтение состояния
// ============================================================================

export function getProjectState(id: string): ProjectState | null {
  ensureDir(STATE_DIR);
  const filePath = path.join(STATE_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  const state = JSON.parse(raw) as ProjectState;

  // Migrate schema v1 → v2 (add blocks)
  if (!state.blocks || state.schema_version < 2) {
    migrateToV2(state);
    const migratedPath = path.join(STATE_DIR, `${id}.json`);
    fs.writeFileSync(migratedPath, JSON.stringify(state, null, 2), "utf-8");
  }

  // Auto-recover stuck agents: running for >10 min with no process
  let stateChanged = false;
  const now = Date.now();
  const STUCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

  for (const [agentId, agent] of Object.entries(state.agents)) {
    if (agent.status !== "running" || !agent.started_at) continue;

    const elapsed = now - new Date(agent.started_at).getTime();
    if (elapsed < STUCK_TIMEOUT_MS) continue;

    // Check if ANY output files exist — agent may have completed but callback missed
    // Agents can create files via stdout capture ({agent}-output.md) OR via Claude Write tool
    const phase = getAgentPhase(agentId);
    const outDir = path.join(PROJECTS_DIR, id, phase, agentId);
    const projectDir = path.join(PROJECTS_DIR, id);

    // Check for any non-internal artifact files in the agent's output directory
    let hasOutput = false;
    let latestMtime = 0;
    if (fs.existsSync(outDir)) {
      for (const f of fs.readdirSync(outDir)) {
        if (f.startsWith("_") || f === ".DS_Store") continue;  // skip internal files
        const fp = path.join(outDir, f);
        const stat = fs.statSync(fp);
        if (stat.isFile() && stat.size > 0) {
          hasOutput = true;
          if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
        }
      }
    }

    // Only count output as valid if files were modified AFTER agent started
    const startedAtMs = new Date(agent.started_at).getTime();
    if (hasOutput && latestMtime > startedAtMs) {
      // Agent completed but callback was lost — recover
      agent.status = "completed";
      agent.completed_at = new Date(latestMtime).toISOString();
      agent.artifacts = collectArtifacts(outDir, projectDir);
      agent.error = null;
      stateChanged = true;

      // Read usage from _usage.json if available
      const usageFile = path.join(outDir, "_usage.json");
      if (fs.existsSync(usageFile)) {
        try {
          const usage = JSON.parse(fs.readFileSync(usageFile, "utf-8"));
          if (usage && !agent.usage_history?.some((u: any) => u.duration_ms === usage.duration_ms && u.input_tokens === usage.input_tokens)) {
            agent.usage = usage;
            if (!agent.usage_history) agent.usage_history = [];
            agent.usage_history.push(usage);
            const history = agent.usage_history;
            agent.total_usage = {
              input_tokens: history.reduce((s: number, u: any) => s + u.input_tokens, 0),
              output_tokens: history.reduce((s: number, u: any) => s + u.output_tokens, 0),
              cache_creation_tokens: history.reduce((s: number, u: any) => s + (u.cache_creation_tokens || 0), 0),
              cache_read_tokens: history.reduce((s: number, u: any) => s + (u.cache_read_tokens || 0), 0),
              cost_usd: history.reduce((s: number, u: any) => s + u.cost_usd, 0),
              duration_ms: history.reduce((s: number, u: any) => s + u.duration_ms, 0),
              model: usage.model,
            };
          }
        } catch { /* ignore */ }
      }

      // Add run_history record for auto-recovered agent
      if (!agent.run_history) agent.run_history = [];
      let runNum = (agent.current_run || agent.run_history.length) + 1;
      try {
        const savedRunNum = parseInt(fs.readFileSync(path.join(outDir, "_current_run"), "utf-8").trim());
        if (savedRunNum > 0) runNum = savedRunNum;
      } catch { /* fallback */ }
      agent.current_run = runNum;
      agent.run_history.push({
        run_number: runNum,
        started_at: agent.started_at || new Date().toISOString(),
        completed_at: agent.completed_at!,
        status: "completed" as const,
        usage: agent.usage || undefined,
        error: undefined,
        artifacts: agent.artifacts,
        run_dir: `runs/${String(runNum).padStart(3, "0")}`,
      });

      // Mark received feedback as resolved
      if (agent.feedback_received?.length) {
        const now = new Date().toISOString();
        for (const fb of agent.feedback_received) {
          if (!fb.resolved) {
            fb.resolved = true;
            fb.resolved_at = now;
          }
        }
      }

      // If this was pipeline-architect — expand the graph
      if (agentId === "pipeline-architect" && state.pipeline_graph.nodes.length <= 5) {
        console.log("[Auto-recovery] PA completed, expanding pipeline graph");
        expandPipelineFromArchitect(state, id);
      }

      // Auto-feedback: QA/Security/DevOps — parse and apply feedback
      if (FEEDBACK_AGENTS.has(agentId)) {
        const feedbackItems = parseAutoFeedback(agentId, outDir);
        if (feedbackItems.length > 0) {
          console.log(`[Auto-recovery] ${agentId} produced ${feedbackItems.length} feedback items`);
          const anyReset = applyAutoFeedback(state, id, agentId, feedbackItems);
          if (anyReset) {
            console.log(`[Auto-recovery] Target agents reset to pending`);
            state.status = "running";
          }
        }
      }
    } else {
      // No new output (or stale files from previous run) — check if process is still alive
      const pidFile = path.join(outDir, "_pid");
      let processAlive = false;
      if (fs.existsSync(pidFile)) {
        try {
          const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim());
          process.kill(pid, 0); // check if process exists
          processAlive = true;
        } catch {
          processAlive = false;
        }
      }

      if (!processAlive) {
        // Process gone, no output — mark as failed
        agent.status = "failed";
        agent.completed_at = new Date().toISOString();
        agent.error = "Процесс агента завершился без результата (таймаут или сбой)";
        stateChanged = true;
      }
    }
  }

  // Catch-all: if PA completed but graph was never expanded
  if (
    state.agents["pipeline-architect"]?.status === "completed" &&
    state.pipeline_graph.nodes.length <= 5
  ) {
    console.log("[getProjectState] PA completed but graph not expanded — fixing now");
    expandPipelineFromArchitect(state, id);
    stateChanged = true;
  }

  // Fix stale "running" status: if all agents done but pipeline still shows running
  // Skip for debate projects — they manage their own completion via debate.status
  if (state.status === "running" && state.pipeline_type !== "debate" && state.pipeline_graph.nodes.length > 0) {
    const allDone = state.pipeline_graph.nodes.every((n) => {
      const s = state.agents[n]?.status;
      return s === "completed" || s === "skipped";
    });
    if (allDone) {
      state.status = "completed";
      stateChanged = true;
    }
  }

  if (stateChanged) {
    state.updated_at = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));

    // Auto-launch pending agents that were reset by feedback
    if (state.status === "running" && state.mode === "auto") {
      const readyToLaunch = findReadyAgents(state);
      if (readyToLaunch.length > 0) {
        console.log(`[Auto-recovery] Launching ready agents: ${readyToLaunch.join(", ")}`);
        for (const nextAgent of readyToLaunch) {
          if (state.agents[nextAgent]?.status === "pending") {
            state.agents[nextAgent].status = "running";
            state.agents[nextAgent].started_at = new Date().toISOString();
            state.agents[nextAgent].error = null;
          }
        }
        state.updated_at = new Date().toISOString();
        fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
        for (const nextAgent of readyToLaunch) {
          spawnAgent(id, nextAgent, state);
        }
      }
    }
  }

  // Detect web project by scanning package.json for web frameworks
  const WEB_FRAMEWORKS = new Set([
    "express", "next", "react", "vue", "nuxt", "vite", "fastify",
    "@nestjs/core", "hono", "koa", "svelte", "@sveltejs/kit", "astro", "remix",
  ]);
  try {
    if (state.project_path) {
      const pkgPath = path.join(state.project_path, "package.json");
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        state.is_web_project = Object.keys(allDeps).some((d) => WEB_FRAMEWORKS.has(d));
      } else {
        state.is_web_project = false;
      }
    } else {
      state.is_web_project = false;
    }
  } catch {
    state.is_web_project = false;
  }

  return state;
}

export function saveProjectState(id: string, state: ProjectState): void {
  ensureDir(STATE_DIR);
  const filePath = path.join(STATE_DIR, `${id}.json`);
  state.updated_at = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}

function getAgentPhase(agentId: string): string {
  const phaseMap: Record<string, string> = {
    "pipeline-architect": "meta", "orchestrator": "meta",
    "problem-researcher": "research", "market-researcher": "research",
    "product-owner": "product", "business-analyst": "product",
    "legal-compliance": "legal",
    "ux-ui-designer": "design",
    "system-architect": "development", "tech-lead": "development",
    "backend-developer": "development", "frontend-developer": "development",
    "devops-engineer": "development",
    "qa-engineer": "quality", "security-engineer": "quality",
    "release-manager": "release",
    "product-marketer": "marketing", "smm-manager": "marketing",
    "content-creator": "marketing",
    "customer-support": "feedback", "data-analyst": "feedback",
  };
  return phaseMap[agentId] || "unknown";
}

export interface ProjectSummary {
  project_id: string;
  name: string;
  description: string;
  project_path?: string;
  status: string;
  mode: string;
  created_at: string;
  updated_at: string;
  current_gate: string | null;
  agents_total: number;
  agents_completed: number;
}

/** Agents that write code/configs to the external project directory (when project_path is set) */
const CODE_AGENTS = new Set([
  "backend-developer",
  "frontend-developer",
  "devops-engineer",
  "qa-engineer",
]);

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
        project_path: state.project_path,
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
  mode: "auto" | "human_approval" = "auto",
  projectPath?: string,
  pipelineType: "standard" | "debate" = "standard",
  debateRoles?: { analyst: string; producer: string; controller: string }
): ProjectState {
  ensureDir(STATE_DIR);
  ensureDir(PROJECTS_DIR);

  const projectId = slugify(name);
  const timestamp = new Date().toISOString();

  // Создаём папку проекта (внутреннюю — для отчётов и state)
  const projectDir = path.join(PROJECTS_DIR, projectId);
  ensureDir(projectDir);

  // Validate and resolve external project path
  let resolvedProjectPath: string | undefined;
  if (projectPath && projectPath.trim()) {
    resolvedProjectPath = path.resolve(projectPath.trim());
    if (!fs.existsSync(resolvedProjectPath)) {
      fs.mkdirSync(resolvedProjectPath, { recursive: true });
    }
  }

  // Empty project — user builds pipeline from scratch
  const state: ProjectState = {
    project_id: projectId,
    name,
    description,
    ...(resolvedProjectPath ? { project_path: resolvedProjectPath } : {}),
    created_at: timestamp,
    updated_at: timestamp,
    mode,
    status: "created",
    current_gate: null,
    pipeline_graph: { nodes: [], edges: [], parallel_groups: [] },
    agents: {},
    gate_decisions: {},
    pipeline_type: pipelineType,
    ...(pipelineType === "debate" ? {
      debate: {
        task: description || name,
        roles: debateRoles || { analyst: "product-owner", producer: "business-analyst", controller: "qa-engineer" },
        current_round: 0,
        max_rounds: 3,
        status: "idle" as const,
        rounds: [],
      },
    } : {}),
    blocks: pipelineType === "debate" && debateRoles ? [
      {
        id: "analyst",
        name: "Аналитик",
        description: "Направляет, приоритизирует, определяет фокус",
        agents: [debateRoles.analyst],
        edges: [] as [string, string][],
        depends_on: [] as string[],
        requires_approval: false,
      },
      {
        id: "producer",
        name: "Производитель",
        description: "Создаёт артефакт по задаче",
        agents: [debateRoles.producer],
        edges: [] as [string, string][],
        depends_on: ["analyst"],
        requires_approval: false,
      },
      {
        id: "controller",
        name: "Контролёр",
        description: "Проверяет и даёт feedback",
        agents: [debateRoles.controller],
        edges: [] as [string, string][],
        depends_on: ["producer"],
        requires_approval: false,
      },
    ] : [],
    schema_version: 2,
    current_cycle: 1,
    cycle_history: [],
  };

  // Initialize agent states for debate projects
  if (pipelineType === "debate" && debateRoles) {
    for (const agentId of [debateRoles.analyst, debateRoles.producer, debateRoles.controller]) {
      state.agents[agentId] = {
        status: "pending",
        started_at: null,
        completed_at: null,
        artifacts: [],
        error: null,
      };
    }
  }

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
  const paPhase = AGENT_PHASES["pipeline-architect"] || "meta";
  const paOutputDir = path.join(PROJECTS_DIR, projectId, paPhase, "pipeline-architect");

  // 1. Try to read pipeline-graph.json (primary source)
  const graphJsonPath = path.join(paOutputDir, "pipeline-graph.json");
  if (fs.existsSync(graphJsonPath)) {
    try {
      const graphData = JSON.parse(fs.readFileSync(graphJsonPath, "utf-8"));

      // Extract node IDs from PA's graph
      let nodeIds: string[] = [];
      if (graphData.nodes && Array.isArray(graphData.nodes)) {
        nodeIds = graphData.nodes
          .map((n: unknown) => typeof n === "string" ? n : (n as { id?: string }).id)
          .filter((id: unknown): id is string =>
            typeof id === "string" &&
            id !== "pipeline-architect" &&
            id !== "orchestrator" &&
            !id.startsWith("gate_") // gates are not agents
          );
      }

      // Extract edges — support both [from, to] arrays and {from, to} objects
      let edges: [string, string][] = [];
      const nodeIdSet = new Set(nodeIds);

      if (graphData.edges && Array.isArray(graphData.edges)) {
        for (const e of graphData.edges) {
          let from: string | undefined;
          let to: string | undefined;

          if (Array.isArray(e) && e.length >= 2) {
            from = e[0];
            to = e[1];
          } else if (e && typeof e === "object") {
            from = (e as { from?: string }).from;
            to = (e as { to?: string }).to;
          }

          if (from && to && typeof from === "string" && typeof to === "string") {
            // Skip gate nodes — connect through them
            if (from.startsWith("gate_") || to.startsWith("gate_")) continue;
            if (nodeIdSet.has(from) && nodeIdSet.has(to)) {
              edges.push([from, to]);
            }
          }
        }
      }

      // Also extract edges from depends_on in nodes
      if (graphData.nodes && Array.isArray(graphData.nodes)) {
        for (const node of graphData.nodes) {
          if (!node || typeof node !== "object") continue;
          const nodeObj = node as { id?: string; depends_on?: string[] };
          const id = nodeObj.id;
          const deps = nodeObj.depends_on;
          if (!id || !deps || !Array.isArray(deps)) continue;
          if (id.startsWith("gate_")) continue;

          for (const dep of deps) {
            if (typeof dep !== "string") continue;
            if (dep.startsWith("gate_")) {
              // Find what feeds into this gate and connect directly
              const gateNode = (graphData.nodes as { id?: string; depends_on?: string[] }[])
                .find((n) => n?.id === dep);
              if (gateNode?.depends_on) {
                for (const gateDep of gateNode.depends_on) {
                  if (typeof gateDep === "string" && nodeIdSet.has(gateDep) && nodeIdSet.has(id)) {
                    edges.push([gateDep, id]);
                  }
                }
              }
            } else if (nodeIdSet.has(dep) && nodeIdSet.has(id)) {
              edges.push([dep, id]);
            }
          }
        }
      }

      // Deduplicate edges
      const edgeSet = new Set(edges.map(([s, t]) => `${s}:${t}`));
      edges = Array.from(edgeSet).map((e) => e.split(":") as [string, string]);

      if (nodeIds.length >= 3) {
        console.log(`[PA] Using pipeline-graph.json: ${nodeIds.length} agents`);
        if (graphData.excluded_agents) {
          const excluded = (graphData.excluded_agents as { id: string }[]).map((e) => e.id);
          console.log(`[PA] Excluded: ${excluded.join(", ")}`);
        }
        applyParsedGraph(state, nodeIds, edges);
        return;
      }
    } catch (err) {
      console.error("[PA] Failed to parse pipeline-graph.json:", err);
    }
  }

  // 2. Fallback: read markdown output and look for JSON block
  let paOutput = "";
  if (fs.existsSync(paOutputDir)) {
    for (const file of fs.readdirSync(paOutputDir)) {
      if (file.endsWith(".md") && !file.startsWith("_")) {
        paOutput += fs.readFileSync(path.join(paOutputDir, file), "utf-8");
      }
    }
  }

  const jsonMatch = paOutput.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.nodes && Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
        const nodeIds = parsed.nodes
          .map((n: unknown) => typeof n === "string" ? n : (n as { id?: string }).id)
          .filter((id: unknown): id is string =>
            typeof id === "string" && !id.startsWith("gate_")
          );
        console.log(`[PA] Using JSON from markdown: ${nodeIds.length} agents`);
        applyParsedGraph(state, nodeIds, parsed.edges || []);
        return;
      }
    } catch { /* not valid JSON */ }
  }

  // 3. Final fallback: full graph (should rarely happen)
  console.log("[PA] No valid graph found, using full agent set");
  const ALL_AGENT_IDS = Object.keys(AGENT_DIRS);
  buildGraphFromAgentList(state, ALL_AGENT_IDS.filter(
    (id) => id !== "orchestrator"
  ));
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

  // Sync state.agents with graph nodes
  const staticChain = new Set([
    "problem-researcher", "market-researcher", "product-owner", "pipeline-architect",
  ]);

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

  // Remove only pending/failed agents no longer in graph (keep completed)
  for (const agentId of Object.keys(state.agents)) {
    if (!state.pipeline_graph.nodes.includes(agentId) && !staticChain.has(agentId)) {
      const status = state.agents[agentId]?.status;
      if (status === "pending" || status === "failed") {
        delete state.agents[agentId];
      }
      // completed/running agents stay — their work is done, artifacts exist
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
  // Контент-конвейер
  "trend-researcher": "content/trend-researcher",
  "catalog-analyst": "content/catalog-analyst",
  "content-strategist": "content/content-strategist",
  "post-writer": "content/post-writer",
  "script-writer": "content/script-writer",
  "story-writer": "content/story-writer",
  "image-generator": "content/image-generator",
  "video-generator": "content/video-generator",
  "music-composer": "content/music-composer",
  "content-assembler": "content/content-assembler",
  "quality-checker": "content/quality-checker",
  "telegram-poster": "content/telegram-poster",
  "instagram-poster": "content/instagram-poster",
  "youtube-poster": "content/youtube-poster",
  "analytics-collector": "content/analytics-collector",
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
  // Контент-конвейер
  "trend-researcher": "content",
  "catalog-analyst": "content",
  "content-strategist": "content",
  "post-writer": "content",
  "script-writer": "content",
  "story-writer": "content",
  "image-generator": "content",
  "video-generator": "content",
  "music-composer": "content",
  "content-assembler": "content",
  "quality-checker": "content",
  "telegram-poster": "content",
  "instagram-poster": "content",
  "youtube-poster": "content",
  "analytics-collector": "content",
};

/**
 * Найти агентов, готовых к запуску.
 * Условия: все зависимости completed + не заблокирован gate-точкой.
 */
function findReadyAgents(state: ProjectState): string[] {
  // Debate projects manage their own execution via /api/state/[id]/debate
  if (state.pipeline_type === "debate") return [];

  const { computeAllBlockStatuses } = require("./types") as typeof import("./types");

  // If we have blocks, use block-aware logic
  if (state.blocks?.length) {
    const blockStatuses = computeAllBlockStatuses(state.blocks, state.agents);
    const ready: string[] = [];

    for (const block of state.blocks) {
      const bs = blockStatuses[block.id];

      // Auto-advance: automatically approve blocks waiting for approval
      if (bs === "awaiting_approval" && state.auto_advance) {
        block.approval = {
          decision: "go",
          decided_by: "auto_advance",
          timestamp: new Date().toISOString(),
          notes: "Автоматическое одобрение (auto_advance включён)",
        };
        state.updated_at = new Date().toISOString();
        // Recalculate statuses after auto-approval
        const newStatuses = computeAllBlockStatuses(state.blocks, state.agents);
        const newBs = newStatuses[block.id];
        if (newBs === "completed") continue;
        if (newBs === "blocked") break;
        // Fall through to process agents in this block
      } else if (bs === "completed") {
        continue; // Skip completed blocks
      } else if (bs === "blocked" || bs === "awaiting_approval") {
        break; // STOP — can't proceed past a blocked/awaiting block
      }

      // This is the first active block — collect ready agents within it
      for (const agentId of block.agents) {
        const agent = state.agents[agentId];
        if (!agent || agent.status !== "pending") continue;

        // Check intra-block dependencies (edges within the block)
        const deps = (block.edges || [])
          .filter(([, tgt]: [string, string]) => tgt === agentId)
          .map(([src]: [string, string]) => src);

        const allDone = deps.every(
          (d: string) => state.agents[d]?.status === "completed"
        );
        if (allDone) ready.push(agentId);
      }
      // Strict sequential: only process ONE block at a time
      break;
    }
    return ready;
  }

  // Legacy: use pipeline_graph (for v1 projects without blocks)
  const blockedByGate = new Set<string>();
  for (const gate of GATES) {
    if (state.gate_decisions[gate.name]) continue;
    const afterInGraph = gate.after.filter((a) =>
      state.pipeline_graph.nodes.includes(a)
    );
    const allAfterDone = afterInGraph.length > 0 && afterInGraph.every(
      (a) => state.agents[a]?.status === "completed"
    );
    if (allAfterDone) {
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
  const codeContextAgents = new Set([
    "backend-developer", "frontend-developer",
    "devops-engineer", "qa-engineer", "security-engineer",
    "release-manager", "tech-lead",
  ]);
  if (codeContextAgents.has(agentId)) {
    // Use external project tree if available, otherwise internal
    const tree = state.project_path
      ? getProjectTreeFromPath(state.project_path)
      : getProjectTree(state.project_id);
    if (tree) {
      parts.push(`\n--- Структура проекта ---\n${tree}\n`);
    }
  }

  // Add feedback received (bug reports, security issues returned from QA/Security/DevOps)
  const feedback = state.agents[agentId]?.feedback_received?.filter(f => !f.resolved) || [];
  if (feedback.length > 0) {
    parts.push(`\n# ⚠️ ИСПРАВЛЕНИЯ ТРЕБУЮТСЯ — Feedback от других агентов\n`);
    parts.push(`Тебе вернули задачу с замечаниями. ТЫ ДОЛЖЕН ИСПРАВИТЬ каждую проблему.\n`);
    parts.push(`НЕ ПЕРЕПИСЫВАЙ весь код. Исправь ТОЛЬКО указанные проблемы.\n`);
    for (const fb of feedback) {
      const severityEmoji = {
        critical: "🔴 CRITICAL",
        high: "🟠 HIGH",
        medium: "🟡 MEDIUM",
        low: "🟢 LOW",
      }[fb.severity] || fb.severity;

      parts.push(`\n## ${severityEmoji} — от ${fb.from_agent}`);
      parts.push(`${fb.description}\n`);
    }
    parts.push(`\nПосле исправления каждой проблемы ОБЯЗАТЕЛЬНО укажи в отчёте:\n`);
    parts.push(`1. Какое именно замечание исправлено (процитируй кратко)\n`);
    parts.push(`2. Что конкретно было сделано\n`);
    parts.push(`3. Формат: "✅ [замечание] — [что сделано]"\n`);
  }

  return parts.join("\n");
}

/**
 * Get a compact file tree of the project (excluding node_modules etc).
 */
function getProjectTreeFromPath(dirPath: string, maxDepth = 4): string {
  if (!fs.existsSync(dirPath)) return "";

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

  walk(dirPath, "", 0);
  return lines.join("\n");
}

function getProjectTree(projectId: string, maxDepth = 4): string {
  const projectDir = path.join(PROJECTS_DIR, projectId);
  return getProjectTreeFromPath(projectDir, maxDepth);
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

  // Load skills: shared (only for code agents) + agent-specific
  let skillsContent = "";
  const agentSkillsDir = path.join(agentDir, "skills");

  // Shared skills (model-selector, test-infrastructure) only for code agents
  if (CODE_AGENTS.has(agentId)) {
    const sharedSkillsDir = path.join(AGENTS_DIR, "shared", "skills");
    try {
      if (fs.existsSync(sharedSkillsDir)) {
        for (const file of fs.readdirSync(sharedSkillsDir)) {
          if (file.endsWith(".md")) {
            const content = fs.readFileSync(path.join(sharedSkillsDir, file), "utf-8");
            skillsContent += `\n\n---\n${content}`;
          }
        }
      }
    } catch { /* */ }
  }

  // Agent-specific skills (always loaded)
  try {
    if (fs.existsSync(agentSkillsDir)) {
      for (const file of fs.readdirSync(agentSkillsDir)) {
        if (file.endsWith(".md")) {
          const content = fs.readFileSync(path.join(agentSkillsDir, file), "utf-8");
          skillsContent += `\n\n---\n${content}`;
        }
      }
    }
  } catch { /* */ }

  const context = collectInputContext(agentId, state);

  // Agent-specific additions
  let agentSpecificContext = "";
  if (agentId === "ux-ui-designer") {
    // Provide the .pen file path so the agent knows where to create the design
    const penFileName = `${state.project_id}.pen`;
    const penFilePath = path.join(PROJECTS_DIR, state.project_id, penFileName);
    agentSpecificContext = `\n\n# Создание дизайна в Pencil (.pen файл)

## ЖЁСТКИЕ ПРАВИЛА — выполняй СТРОГО в этом порядке:

### Шаг 1: Инициализация Pencil
1. Вызови mcp__pencil__get_editor_state с include_schema=true
2. Вызови mcp__pencil__get_guidelines с topic подходящим для задачи (web-app, mobile-app, landing-page)
3. Вызови mcp__pencil__get_style_guide_tags
4. Вызови mcp__pencil__get_style_guide с подходящими тегами

### Шаг 2: Создание .pen файла
5. Вызови mcp__pencil__open_document с filePathOrTemplate="${penFilePath}"
   - Это создаст НОВЫЙ .pen файл по указанному пути
   - Если вернулась ошибка — попробуй filePathOrTemplate="new"

### Шаг 3: Дизайн экранов
6. Создавай экраны через mcp__pencil__batch_design (максимум 25 операций за вызов)
7. После каждого экрана — проверяй через mcp__pencil__get_screenshot

### Шаг 4: Документация
8. Создай wireframes.md с текстовым описанием всех экранов и user flows
9. Создай design_system.md с цветами, шрифтами, компонентами

ПУТЬ К ФАЙЛУ: ${penFilePath}

КРИТИЧНО: Файл .pen ОБЯЗАТЕЛЕН. Без него задача считается НЕВЫПОЛНЕННОЙ.
Если MCP tools не отвечают (таймаут) — напиши об этом в output и создай wireframes.md с ASCII-макетами как fallback.
`;
  }

  // External project directory instructions
  if (state.project_path && CODE_AGENTS.has(agentId)) {
    agentSpecificContext += `\n\n# Рабочая директория проекта

ВАЖНО: Ты работаешь в ВНЕШНЕЙ директории проекта:
**${state.project_path}**

Весь код (исходники, конфиги, тесты, docker-файлы) пиши В ТЕКУЩЕЙ ДИРЕКТОРИИ.
Отчёт в формате Markdown выводи как обычно — через stdout.

Если в директории уже есть код — это существующий проект. Изучи его структуру перед началом работы.
НЕ создавай проект заново, если он уже существует. Работай с тем, что есть.
`;
  } else if (state.project_path && !CODE_AGENTS.has(agentId)) {
    // Non-code agents that reference code (architect, tech-lead, security, etc.)
    const codeRefAgents = new Set([
      "system-architect", "tech-lead", "security-engineer",
      "release-manager", "qa-engineer",
    ]);
    if (codeRefAgents.has(agentId)) {
      agentSpecificContext += `\n\n# Путь к проекту (только для справки)

Код проекта находится в: **${state.project_path}**
Ты пишешь ТОЛЬКО отчёт/документацию. Код не пиши — это задача разработчиков.
`;
    }
  }

  const fullPrompt = [
    systemPrompt,
    rules ? `\n\n# Правила\n\n${rules}` : "",
    skillsContent ? `\n\n# Навыки и знания\n${skillsContent}` : "",
    agentSpecificContext,
    context ? `\n\n# Входные данные\n\n${context}` : "",
    CODE_AGENTS.has(agentId)
      ? `\n\n# Инструкции

Ты работаешь как автономный агент. Выполни задачу ПОЛНОСТЬЮ за одну сессию.

## Стратегия работы
1. СНАЧАЛА изучи текущую структуру проекта (ls, find, cat package.json)
2. Составь план работы — запиши его для себя
3. Реализуй КАЖДЫЙ пункт плана — не пропускай
4. После реализации — проверь: запусти тесты, проверь сборку
5. Если что-то не работает — ИСПРАВЬ, не оставляй сломанным

## Управление контекстом
- Если задача большая — разбей на подзадачи и выполняй последовательно
- Используй TodoWrite для отслеживания прогресса
- Если контекст заканчивается — сохрани промежуточный результат и напиши summary
- НЕ пиши "TODO: реализовать позже" — реализуй СЕЙЧАС

## Вывод
Весь код пиши ПРЯМО В ФАЙЛЫ проекта (через Edit/Write tool).
В stdout верни ТОЛЬКО краткий отчёт: что сделано, какие файлы созданы/изменены, результаты тестов.
Формат отчёта — Markdown.`
      : `\n\n# Инструкции\n\nВыполни задачу и верни результат в формате Markdown. Весь твой вывод будет сохранён как артефакт. Не пиши ничего лишнего — только структурированный отчёт.`,
  ].join("");

  const tmpFile = path.join(os.tmpdir(), `agent-prompt-${agentId}-${Date.now()}.md`);
  fs.writeFileSync(tmpFile, fullPrompt, "utf-8");
  return tmpFile;
}

// --- Model Selection ---

type ModelTier = "opus" | "sonnet" | "haiku";

/** Default model per agent based on task complexity */
const DEFAULT_MODEL: Record<string, ModelTier> = {
  // Opus — complex analytical, architectural, security, legal
  "system-architect": "opus",
  "security-engineer": "opus",
  "legal-compliance": "opus",
  "pipeline-architect": "opus",

  // Sonnet — standard development, analysis, strategy
  "problem-researcher": "sonnet",
  "market-researcher": "sonnet",
  "product-owner": "sonnet",
  "business-analyst": "sonnet",
  "ux-ui-designer": "sonnet",
  "tech-lead": "sonnet",
  "backend-developer": "sonnet",
  "frontend-developer": "sonnet",
  "devops-engineer": "sonnet",
  "qa-engineer": "sonnet",
  "release-manager": "sonnet",
  "product-marketer": "sonnet",
  "data-analyst": "sonnet",
  "orchestrator": "sonnet",

  // Haiku — simple content, templates, formatting
  "smm-manager": "haiku",
  "content-creator": "haiku",
  "customer-support": "haiku",
};

/**
 * Dynamically classify prompt complexity using a quick Haiku call.
 * Falls back to static DEFAULT_MODEL on failure.
 */
function selectModel(agentId: string, promptContent: string): ModelTier {
  const defaultModel = DEFAULT_MODEL[agentId] || "sonnet";

  try {
    // Take first 2000 chars of the prompt for classification (enough context, fast)
    const promptSample = promptContent.slice(0, 2000);

    const classificationPrompt = `Ты — классификатор сложности задач. Проанализируй задачу ниже и определи уровень сложности.

Ответь ОДНИМ СЛОВОМ:
- opus — если задача требует глубокого аналитического мышления, архитектурных решений, анализа безопасности, юридического анализа, или принятия решений с множеством trade-off
- sonnet — если задача стандартной сложности: написание кода, генерация документации, тестирование, настройка инфраструктуры
- haiku — если задача простая: форматирование, шаблоны, короткие тексты, FAQ, простые конфиги

Агент: ${agentId}
Дефолтная модель: ${defaultModel}

Задача:
${promptSample}

Ответь ТОЛЬКО одним словом: opus, sonnet или haiku`;

    const { execSync } = require("child_process");
    const result = execSync(
      `echo ${JSON.stringify(classificationPrompt)} | claude --print --model haiku --no-input 2>/dev/null`,
      { encoding: "utf-8", timeout: 15000 }
    ).trim().toLowerCase();

    // Parse response — extract model name
    if (result.includes("opus")) return "opus";
    if (result.includes("haiku")) return "haiku";
    if (result.includes("sonnet")) return "sonnet";

    // If Haiku returned something unexpected, use default
    console.log(`[ModelSelector] ${agentId}: Haiku returned "${result}", using default "${defaultModel}"`);
    return defaultModel;
  } catch (err) {
    // Classification failed — use static default
    console.log(`[ModelSelector] ${agentId}: classification failed, using default "${defaultModel}"`);
    return defaultModel;
  }
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
      else if (
        (entry.name.endsWith(".md") || entry.name.endsWith(".pen") || entry.name.endsWith(".json") || entry.name.endsWith(".png"))
        && !entry.name.startsWith("_")
      ) {
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
  // Auto-advance: skip all gates
  if (state.auto_advance) return null;

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
 * Parse structured feedback from agent output (json:feedback blocks).
 * QA/Security/DevOps agents output feedback in this format:
 * ```json:feedback
 * [{ "to_agent": "backend-developer", "severity": "critical", "description": "..." }]
 * ```
 */
function parseAutoFeedback(
  agentId: string,
  outputDir: string
): { to_agent: string; severity: string; description: string }[] {
  const results: { to_agent: string; severity: string; description: string }[] = [];
  if (!fs.existsSync(outputDir)) return results;

  // Read ALL .md files in agent's output dir (not just *-output.md)
  // Agents may write json:feedback in qa_report.md, security_report.md, etc.
  const mdFiles = fs.readdirSync(outputDir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .map((f) => path.join(outputDir, f));

  for (const filePath of mdFiles) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const feedbackRegex = /```json:feedback\s*\n([\s\S]*?)```/g;
      let match;
      while ((match = feedbackRegex.exec(content)) !== null) {
        try {
          const parsed = JSON.parse(match[1]);

          // Format 1: Array of {to_agent, severity, description}
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item.to_agent && item.severity && item.description) {
                results.push({
                  to_agent: item.to_agent,
                  severity: item.severity,
                  description: item.description,
                });
              }
            }
          }
          // Format 2: Object with {targets: [{agent, priority, findings, actions}]}
          else if (parsed.targets && Array.isArray(parsed.targets)) {
            for (const target of parsed.targets) {
              const toAgent = target.agent || target.to_agent;
              const severity = target.priority || target.severity || "high";
              if (!toAgent) continue;
              const actions = Array.isArray(target.actions) ? target.actions : [];
              const findings = Array.isArray(target.findings) ? target.findings : [];
              const desc = actions.length > 0
                ? actions.map((a: string, i: number) => `${findings[i] || `ITEM-${i+1}`}: ${a}`).join("\n")
                : target.description || findings.join(", ");
              if (desc) {
                results.push({ to_agent: toAgent, severity, description: desc });
              }
            }
          }
          // Format 3: Object with {findings: [{id, severity, target, title, action}]}
          else if (parsed.findings && Array.isArray(parsed.findings)) {
            for (const f of parsed.findings) {
              const toAgent = f.target || f.to_agent;
              const severity = f.severity || "high";
              if (!toAgent) continue;
              const parts = [];
              if (f.id) parts.push(f.id);
              if (f.title) parts.push(f.title);
              if (f.file) parts.push(`Файл: ${f.file}`);
              if (f.action) parts.push(`Действие: ${f.action}`);
              const desc = parts.join(": ") || f.description || "";
              if (desc) {
                results.push({ to_agent: toAgent, severity, description: desc });
              }
            }
          }
          // Format 4: Single object with {to_agent, severity, description}
          else if (parsed.to_agent && parsed.severity && parsed.description) {
            results.push({
              to_agent: parsed.to_agent,
              severity: parsed.severity,
              description: parsed.description,
            });
          }
        } catch {
          console.warn(`[parseAutoFeedback] Failed to parse feedback JSON in ${path.basename(filePath)}`);
        }
      }
    } catch { /* unreadable file */ }
  }

  // FALLBACK: if no json:feedback found, extract issues from text
  if (results.length === 0) {
    console.log(`[parseAutoFeedback] No json:feedback block found for ${agentId}, trying text extraction`);
    const allContent = mdFiles
      .map((f) => { try { return fs.readFileSync(f, "utf-8"); } catch { return ""; } })
      .join("\n");
    const textResults = extractFeedbackFromText(agentId, allContent);
    if (textResults.length > 0) {
      console.log(`[parseAutoFeedback] Text extraction found ${textResults.length} issues for ${agentId}`);
      results.push(...textResults);
    }
  }

  return results;
}

/**
 * Fallback: extract critical/high issues from plain text report.
 * Matches patterns like:
 *   - "Critical: ...", "High: ...", "🔴 CRITICAL", "BUG-001 (Critical)"
 *   - "SEC-001", "BUG-001", "FINDING-001"
 * Routes to target agent based on file paths or keywords in the description.
 */
function extractFeedbackFromText(
  fromAgent: string,
  content: string
): { to_agent: string; severity: string; description: string }[] {
  const results: { to_agent: string; severity: string; description: string }[] = [];

  // Patterns for issue lines with severity
  const issuePatterns = [
    // ### SEC-001: Description (Critical)  or  ### BUG-001: Description (High)
    /###\s*(?:BUG|SEC|FINDING|VULN|DEF|ISSUE)[-_](\d+):\s*(.+?)\s*\((critical|high)\)/gi,
    // BUG-001 (Critical): description
    /(?:BUG|SEC|FINDING|VULN|DEF|ISSUE)[-_](\d+)\s*[:\(]\s*(critical|high)\)?[:\s]+(.+)/gi,
    // | BUG-001 | Critical | description | file |
    /\|\s*(?:BUG|SEC|FINDING|VULN|DEF|ISSUE)[-_]\d+\s*\|\s*(critical|high)\s*\|\s*(.+?)\s*\|/gi,
    // | **BUG-001** | High | description | file | status |
    /\|\s*\*{0,2}(?:BUG|SEC|FINDING|VULN|DEF|ISSUE)[-_]\d+\*{0,2}\s*\|\s*(critical|high)\s*\|\s*(.+?)\s*\|/gi,
    // **Critical**: description  or  **High**: description
    /\*\*(critical|high)\*\*[:\s]+(.+)/gi,
    // 🔴 CRITICAL: description  or  🟠 HIGH: description
    /(?:🔴|🟠)\s*(?:CRITICAL|HIGH)[:\s]+(.+)/gi,
    // Severity: Critical — description
    /severity[:\s]+(critical|high)[,\s—\-:]+(.+)/gi,
  ];

  const seenDescs = new Set<string>();

  // First pass: extract ### SEC-NNN sections with Location context
  const sectionRegex = /###\s*((?:BUG|SEC|FINDING|VULN|DEF|ISSUE)[-_]\d+):\s*(.+?)\s*\((critical|high)\)\s*\n([\s\S]*?)(?=\n###|\n##[^#]|$)/gi;
  let sectionMatch;
  while ((sectionMatch = sectionRegex.exec(content)) !== null) {
    const id = sectionMatch[1];
    const title = sectionMatch[2].trim();
    const severity = sectionMatch[3].toLowerCase();
    const body = sectionMatch[4];

    // Skip if already fixed
    if (/✅\s*(?:FIXED|Исправлено|Устранено|Resolved)/i.test(body)) continue;

    // Extract Location
    const locMatch = body.match(/\*\*Location\*\*:\s*`?([^`\n]+)`?/);
    const location = locMatch ? locMatch[1].trim() : "";

    const description = `${id}: ${title}${location ? `. Файл: ${location}` : ""}`;

    const key = id.toLowerCase();
    if (seenDescs.has(key)) continue;
    seenDescs.add(key);

    // Detect target from location + title
    const target = detectTargetAgent(description + " " + body.slice(0, 200));
    results.push({ to_agent: target, severity, description });
  }

  // Second pass: other patterns (table rows, inline mentions)
  for (const pattern of issuePatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      let severity: string;
      let description: string;

      if (match.length === 4) {
        severity = (match[3] || match[2]).toLowerCase();
        description = match[0].trim();
      } else if (match.length === 3) {
        severity = match[1].toLowerCase();
        description = match[0].trim();
      } else {
        severity = "high";
        description = match[0].trim();
      }

      if (severity !== "critical" && severity !== "high") continue;

      // Skip if marked as fixed
      if (/✅\s*(?:FIXED|Исправлено|Устранено|Resolved)/i.test(description)) continue;

      description = description.replace(/^\||\|$/g, "").replace(/\*\*/g, "").replace(/^#+\s*/, "").trim();
      if (description.length < 10 || description.length > 500) continue;

      const key = description.slice(0, 60).toLowerCase();
      if (seenDescs.has(key)) continue;
      seenDescs.add(key);

      const target = detectTargetAgent(description);
      results.push({ to_agent: target, severity, description });
    }
  }

  return results;
}

/** Detect target agent from issue description based on file paths and keywords */
function detectTargetAgent(description: string): string {
  const lower = description.toLowerCase();

  // Frontend indicators
  const frontendPatterns = [
    /\.(tsx|jsx|css|scss)\b/,
    /\bcomponent\b/i,
    /\bfrontend\b/i,
    /\breact\b/i,
    /\bnext\.js\b/i,
    /\blocalstorage\b/i,
    /\bcookie\b/i,
    /\bui\b/,
    /\bform\b/,
    /\bpage\.tsx\b/,
    /\bsrc\/app\//,
    /\bsrc\/components\//,
    /\bsrc\/lib\//,
  ];

  // DevOps indicators
  const devopsPatterns = [
    /\bdocker/i,
    /\bnginx/i,
    /\bci\/cd\b/i,
    /\bgrafana\b/i,
    /\bprometheus\b/i,
    /\btls\b/i,
    /\bssl\b/i,
    /\bcertificat/i,
    /\bhelm\b/i,
    /\bkubernetes\b/i,
    /docker-compose/i,
    /\.ya?ml\b/,
    /\bredis\b.*\b(password|auth)\b/i,
  ];

  for (const p of devopsPatterns) {
    if (p.test(description)) return "devops-engineer";
  }
  for (const p of frontendPatterns) {
    if (p.test(description)) return "frontend-developer";
  }

  // Default to backend
  return "backend-developer";
}

/** Agents that produce auto-feedback (QA, Security, DevOps) */
const FEEDBACK_AGENTS = new Set(["qa-engineer", "security-engineer", "devops-engineer"]);

/** Max auto-feedback iterations to prevent infinite loops */
const MAX_FEEDBACK_ITERATIONS = 3;

/**
 * Apply auto-feedback: create feedback items, reset target agents, auto-start them.
 */
function applyAutoFeedback(
  state: ProjectState,
  id: string,
  fromAgent: string,
  feedbackItems: { to_agent: string; severity: string; description: string }[]
): boolean {
  if (feedbackItems.length === 0) return false;

  const now = new Date().toISOString();
  let anyTargetReset = false;

  // Group by target agent
  const byTarget = new Map<string, typeof feedbackItems>();
  for (const item of feedbackItems) {
    if (!byTarget.has(item.to_agent)) byTarget.set(item.to_agent, []);
    byTarget.get(item.to_agent)!.push(item);
  }

  for (const [targetAgent, items] of byTarget) {
    const target = state.agents[targetAgent];
    if (!target) continue;

    // Check iteration count to prevent infinite loops
    // Count unique feedback CYCLES (by resolved_at timestamp), not individual items
    const existingFeedback = target.feedback_received || [];
    const resolvedTimestamps = new Set(
      existingFeedback
        .filter((f) => f.from_agent === fromAgent && f.resolved && f.resolved_at)
        .map((f) => f.resolved_at)
    );
    const iterationCycles = resolvedTimestamps.size;

    if (iterationCycles >= MAX_FEEDBACK_ITERATIONS) {
      console.log(`[AutoFeedback] Max iterations (${MAX_FEEDBACK_ITERATIONS} cycles) reached for ${fromAgent} → ${targetAgent}, skipping`);
      continue;
    }

    // Create feedback items
    const newFeedback: import("./types").FeedbackItem[] = items.map((item) => ({
      from_agent: fromAgent,
      to_agent: targetAgent,
      severity: item.severity as "critical" | "high" | "medium" | "low",
      description: item.description,
      created_at: now,
      resolved: false,
    }));

    // Add to target agent's feedback_received
    if (!target.feedback_received) target.feedback_received = [];
    target.feedback_received.push(...newFeedback);

    // Add to sender's feedback_sent
    const sender = state.agents[fromAgent];
    if (sender) {
      if (!sender.feedback_sent) sender.feedback_sent = [];
      sender.feedback_sent.push(...newFeedback);
    }

    // Reset target agent to pending (so it can be re-launched)
    if (target.status === "completed" || target.status === "failed") {
      target.status = "pending";
      target.started_at = null;
      target.completed_at = null;
      target.error = null;
      // Don't clear artifacts — agent will modify existing code
      anyTargetReset = true;
    }
  }

  return anyTargetReset;
}

/**
 * Обновить state после завершения агента.
 */
function finalizeAgent(
  id: string,
  agentId: string,
  success: boolean,
  errorMsg?: string,
  usage?: import("./types").AgentUsage | null
): void {
  const state = getProjectState(id);
  if (!state) return;

  // If agent was paused/reset while running — don't overwrite
  if (state.agents[agentId]?.status !== "running") return;

  const phase = AGENT_PHASES[agentId] || "other";
  const outputDir = path.join(PROJECTS_DIR, id, phase, agentId);
  const projectDir = path.join(PROJECTS_DIR, id);
  let feedbackResetOccurred = false;

  if (success) {
    state.agents[agentId].status = "completed";
    state.agents[agentId].artifacts = collectArtifacts(outputDir, projectDir);
    state.agents[agentId].error = null;

    // UX/UI Designer: also collect .pen file from project root
    if (agentId === "ux-ui-designer") {
      // Collect .pen files from project root and output dir
      const penLocations = [
        path.join(projectDir, `${id}.pen`),
        ...fs.readdirSync(outputDir).filter(f => f.endsWith(".pen")).map(f => path.join(outputDir, f)),
      ];
      for (const penFile of penLocations) {
        if (fs.existsSync(penFile)) {
          const relPen = path.relative(projectDir, penFile);
          if (!state.agents[agentId].artifacts.includes(relPen)) {
            state.agents[agentId].artifacts.unshift(relPen);
          }
          // Don't auto-open Pencil — it's an Electron app that shows
          // its own webview (may display dashboard URL instead of file).
          // User can open .pen files manually or via dashboard "Open in Pencil" button.
        }
      }
    }

    // After Pipeline Architect completes → expand graph from its output
    if (agentId === "pipeline-architect") {
      expandPipelineFromArchitect(state, id);
    }

    // Mark all received feedback as resolved when agent completes successfully
    if (state.agents[agentId].feedback_received?.length) {
      const now = new Date().toISOString();
      for (const fb of state.agents[agentId].feedback_received!) {
        if (!fb.resolved) {
          fb.resolved = true;
          fb.resolved_at = now;
        }
      }
      // Also mark in the sender's feedback_sent
      for (const fb of state.agents[agentId].feedback_received!) {
        const sender = state.agents[fb.from_agent];
        if (sender?.feedback_sent) {
          for (const sfb of sender.feedback_sent) {
            if (sfb.to_agent === agentId && sfb.description === fb.description && !sfb.resolved) {
              sfb.resolved = true;
              sfb.resolved_at = now;
            }
          }
        }
      }
    }

    // Auto-feedback: QA/Security/DevOps → parse structured findings → reset target agents
    if (FEEDBACK_AGENTS.has(agentId)) {
      const feedbackItems = parseAutoFeedback(agentId, outputDir);
      if (feedbackItems.length > 0) {
        console.log(`[AutoFeedback] ${agentId} produced ${feedbackItems.length} feedback items`);
        const anyReset = applyAutoFeedback(state, id, agentId, feedbackItems);
        if (anyReset) {
          feedbackResetOccurred = true;
          console.log(`[AutoFeedback] Target agents reset, will auto-launch after state save`);
        }
      }
    }
  } else {
    state.agents[agentId].status = "failed";
    state.agents[agentId].error = errorMsg || "Неизвестная ошибка";
  }

  // Save usage/cost data — accumulate across restarts
  if (usage) {
    state.agents[agentId].usage = usage;

    // Append to history
    if (!state.agents[agentId].usage_history) {
      state.agents[agentId].usage_history = [];
    }
    state.agents[agentId].usage_history!.push(usage);

    // Recalculate total
    const history = state.agents[agentId].usage_history!;
    state.agents[agentId].total_usage = {
      input_tokens: history.reduce((s, u) => s + u.input_tokens, 0),
      output_tokens: history.reduce((s, u) => s + u.output_tokens, 0),
      cache_creation_tokens: history.reduce((s, u) => s + u.cache_creation_tokens, 0),
      cache_read_tokens: history.reduce((s, u) => s + u.cache_read_tokens, 0),
      cost_usd: history.reduce((s, u) => s + u.cost_usd, 0),
      duration_ms: history.reduce((s, u) => s + u.duration_ms, 0),
      model: usage.model,
    };
  }
  state.agents[agentId].completed_at = new Date().toISOString();
  state.updated_at = new Date().toISOString();

  // Save run history record
  const existingHistory = state.agents[agentId].run_history || [];
  // Use _current_run sidecar file written by spawnAgent (source of truth for run number)
  let currentRunNum = existingHistory.length + 1;
  try {
    const savedRunNum = parseInt(fs.readFileSync(path.join(outputDir, "_current_run"), "utf-8").trim());
    if (savedRunNum > 0) currentRunNum = savedRunNum;
  } catch { /* fallback to history length */ }
  state.agents[agentId].current_run = currentRunNum;
  const runDirRel = `runs/${String(currentRunNum).padStart(3, "0")}`;
  const runDirAbs = path.join(outputDir, runDirRel);
  const runRecord: import("./types").AgentRunRecord = {
    run_number: currentRunNum,
    started_at: state.agents[agentId].started_at || new Date().toISOString(),
    completed_at: state.agents[agentId].completed_at!,
    status: success ? "completed" : "failed",
    usage: usage || undefined,
    error: success ? undefined : (errorMsg || "Неизвестная ошибка"),
    artifacts: state.agents[agentId].artifacts,
    run_dir: runDirRel,
  };
  if (!state.agents[agentId].run_history) state.agents[agentId].run_history = [];
  state.agents[agentId].run_history!.push(runRecord);

  // Copy output artifacts to run directory
  try {
    if (fs.existsSync(runDirAbs)) {
      for (const f of fs.readdirSync(outputDir)) {
        if (f === "runs" || f.startsWith("_") && f !== "_reasoning.md" && f !== "_prompt.md" && f !== "_usage.json" && f !== "_model.txt") continue;
        const src = path.join(outputDir, f);
        const dst = path.join(runDirAbs, f);
        if (fs.statSync(src).isFile()) {
          fs.copyFileSync(src, dst);
        }
      }
    }
  } catch { /* ignore copy errors */ }

  if (!success) {
    state.status = "failed";
  } else {
    // Check gates BEFORE checking pipeline completion
    const gate = checkGates(state);
    if (gate) {
      state.status = "paused_at_gate";
      state.current_gate = gate;
    } else if (feedbackResetOccurred) {
      // Feedback reset some agents to pending — pipeline is still running
      state.status = "running";
    } else {
      // Check pipeline completion (skip for debate projects)
      if (state.pipeline_type !== "debate") {
        let allDone = false;
        if (state.blocks?.length) {
          // Block-based: all blocks must be completed
          const { computeAllBlockStatuses } = require("./types") as typeof import("./types");
          const bs = computeAllBlockStatuses(state.blocks, state.agents);
          allDone = state.blocks.every((b) => bs[b.id] === "completed");
        } else if (state.pipeline_graph.nodes.length > 0) {
          // Legacy node-based
          allDone = state.pipeline_graph.nodes.every((n) => {
            const s = state.agents[n]?.status;
            return s === "completed" || s === "skipped";
          });
        }
        if (allDone) state.status = "completed";
      }
    }
  }

  const fp = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(fp, JSON.stringify(state, null, 2), "utf-8");

  // Auto-launch agents that were reset by feedback
  // Works in auto mode, OR when feedback reset occurred (even in human_approval)
  if (success && (state.status === "running" || feedbackResetOccurred) && (state.mode === "auto" || feedbackResetOccurred)) {
    const readyToLaunch = findReadyAgents(state);
    if (readyToLaunch.length > 0) {
      console.log(`[AutoLaunch] After ${agentId}: launching ${readyToLaunch.join(", ")}`);
      // Re-read state to get fresh data
      const freshState = getProjectState(id);
      if (freshState) {
        for (const nextAgent of readyToLaunch) {
          if (freshState.agents[nextAgent]?.status === "pending") {
            freshState.agents[nextAgent].status = "running";
            freshState.agents[nextAgent].started_at = new Date().toISOString();
            freshState.agents[nextAgent].error = null;
          }
        }
        freshState.updated_at = new Date().toISOString();
        fs.writeFileSync(fp, JSON.stringify(freshState, null, 2), "utf-8");
        for (const nextAgent of readyToLaunch) {
          spawnAgent(id, nextAgent, freshState);
        }
      }
    }
  }
}

// ============================================================================
// Rate Limit Retry
// ============================================================================

/** Pending retry timers: projectId → Set<agentId> */
const pendingRetries = new Map<string, Set<string>>();

/**
 * Schedule agent retry at the start of the next hour.
 * Pauses the project and sets up a timer.
 */
function scheduleRateLimitRetry(
  projectId: string,
  agentId: string,
  errorSnippet: string
): void {
  const state = getProjectState(projectId);
  if (!state) return;

  // Calculate next hour start + 1 minute
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setHours(nextHour.getHours() + 1, 1, 0, 0); // XX:01:00
  const delayMs = nextHour.getTime() - now.getTime();

  const retryAt = nextHour.toISOString();
  console.log(`[RateLimit] ${agentId}: will retry at ${retryAt} (in ${Math.round(delayMs / 60000)} min)`);

  // Mark agent as waiting
  state.agents[agentId].status = "pending";
  state.agents[agentId].started_at = null;
  state.agents[agentId].error = `⏳ Rate limit — повтор в ${nextHour.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;

  // Pause ALL running agents to save tokens
  for (const [aid, agent] of Object.entries(state.agents)) {
    if (agent.status === "running" && aid !== agentId) {
      agent.status = "pending";
      agent.started_at = null;
      agent.error = `⏳ Пауза (rate limit) — повтор в ${nextHour.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
      // Kill the process
      const phase = AGENT_PHASES[aid] || "other";
      const pidFile = path.join(PROJECTS_DIR, projectId, phase, aid, "_pid");
      if (fs.existsSync(pidFile)) {
        try {
          const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim());
          if (pid > 0) {
            try { process.kill(-pid, "SIGKILL"); } catch { /* */ }
            const { execSync } = require("child_process");
            try { execSync(`pkill -9 -P ${pid} 2>/dev/null || true`, { timeout: 3000 }); } catch { /* */ }
            try { process.kill(pid, "SIGKILL"); } catch { /* */ }
          }
        } catch { /* */ }
      }
    }
  }

  state.status = "paused";
  state.rate_limit_retry_at = retryAt;
  state.rate_limit_blocked_agent = agentId;
  state.updated_at = new Date().toISOString();
  const fp = path.join(STATE_DIR, `${projectId}.json`);
  fs.writeFileSync(fp, JSON.stringify(state, null, 2), "utf-8");

  armRateLimitTimer(projectId, agentId, delayMs);
}

/** Pending retry timers: projectId → NodeJS.Timeout */
const rateLimitTimers = new Map<string, NodeJS.Timeout>();

function armRateLimitTimer(projectId: string, agentId: string, delayMs: number): void {
  if (!pendingRetries.has(projectId)) pendingRetries.set(projectId, new Set());
  pendingRetries.get(projectId)!.add(agentId);

  const prev = rateLimitTimers.get(projectId);
  if (prev) clearTimeout(prev);

  const timer = setTimeout(() => {
    rateLimitTimers.delete(projectId);
    console.log(`[RateLimit] Retry timer fired for ${projectId}`);
    const retryState = getProjectState(projectId);
    if (!retryState) return;

    for (const agent of Object.values(retryState.agents)) {
      if (agent.error?.includes("rate limit") || agent.error?.includes("Пауза (rate limit)")) {
        agent.error = null;
      }
    }

    retryState.status = "running";
    retryState.rate_limit_retry_at = undefined;
    retryState.rate_limit_blocked_agent = undefined;
    retryState.updated_at = new Date().toISOString();
    const retryFp = path.join(STATE_DIR, `${projectId}.json`);
    fs.writeFileSync(retryFp, JSON.stringify(retryState, null, 2), "utf-8");

    pendingRetries.get(projectId)?.delete(agentId);
    runNextAgent(projectId);
  }, Math.max(0, delayMs));
  rateLimitTimers.set(projectId, timer);
}

/**
 * Cold-restore: on module load, scan all project state files and reschedule
 * rate-limit retry timers for paused projects. Without this, if the dashboard
 * server restarts between the pause and the retry time, projects would stay
 * stuck in `paused` forever.
 */
export function restoreRateLimitRetries(): void {
  try {
    if (!fs.existsSync(STATE_DIR)) return;
    const files = fs.readdirSync(STATE_DIR).filter((f) => f.endsWith(".json"));
    let restored = 0;
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(STATE_DIR, f), "utf-8");
        const s = JSON.parse(raw) as ProjectState;
        if (s.status !== "paused" || !s.rate_limit_retry_at || !s.rate_limit_blocked_agent) continue;
        const retryAtMs = new Date(s.rate_limit_retry_at).getTime();
        if (!Number.isFinite(retryAtMs)) continue;
        const delay = retryAtMs - Date.now();
        console.log(`[RateLimit] Cold-restore ${s.project_id}: retry in ${Math.max(0, Math.round(delay / 1000))}s`);
        armRateLimitTimer(s.project_id, s.rate_limit_blocked_agent, delay);
        restored++;
      } catch { /* skip bad file */ }
    }
    if (restored > 0) console.log(`[RateLimit] Restored ${restored} pending retry timer(s)`);
  } catch (err) {
    console.error("[RateLimit] Cold-restore failed:", err);
  }
}

// Run cold-restore once per process on module load
let _coldRestoreDone = false;
if (!_coldRestoreDone) {
  _coldRestoreDone = true;
  // Defer to next tick so all module-level constants (STATE_DIR etc.) are initialized
  setImmediate(() => restoreRateLimitRetries());
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

  // Create run directory: runs/001, runs/002, etc.
  const runsDir = path.join(outputDir, "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  const existingRuns = fs.readdirSync(runsDir).filter(d => /^\d{3}$/.test(d)).sort();
  const nextRunNum = existingRuns.length > 0 ? parseInt(existingRuns[existingRuns.length - 1]) + 1 : 1;
  const runId = String(nextRunNum).padStart(3, "0");
  const runDir = path.join(runsDir, runId);
  fs.mkdirSync(runDir, { recursive: true });

  // Track current run in state
  if (!state.agents[agentId].run_history) state.agents[agentId].run_history = [];
  state.agents[agentId].current_run = nextRunNum;

  // Persist current_run to a sidecar file so finalizeAgent can read the correct run number
  // (state passed to spawnAgent is not saved back to disk after this point)
  fs.writeFileSync(path.join(outputDir, "_current_run"), String(nextRunNum), "utf-8");

  const tmpFile = prepareAgentPrompt(agentId, state, outputDir);

  // Save the prompt as _prompt.md so we can view it later (reasoning tab)
  const promptContent = fs.readFileSync(tmpFile, "utf-8");
  const promptLogFile = path.join(outputDir, "_prompt.md");
  fs.writeFileSync(promptLogFile, promptContent, "utf-8");
  // Also save to run dir
  fs.writeFileSync(path.join(runDir, "_prompt.md"), promptContent, "utf-8");

  const startTime = Date.now();

  // Select optimal model based on task complexity
  const selectedModel = selectModel(agentId, promptContent);
  console.log(`[ModelSelector] ${agentId}: selected model "${selectedModel}"`);

  // Save model selection info
  const modelLogFile = path.join(outputDir, "_model.txt");
  fs.writeFileSync(modelLogFile, `model: ${selectedModel}\nagent: ${agentId}\ndefault: ${DEFAULT_MODEL[agentId] || "sonnet"}\ntimestamp: ${new Date().toISOString()}\n`, "utf-8");

  // Build Claude CLI command with agent-specific MCP tools
  let claudeCmd = `cat "${tmpFile}" | claude --print --output-format json --model ${selectedModel} --dangerously-skip-permissions`;

  // UX/UI Designer gets access to Pencil MCP for .pen file creation
  if (agentId === "ux-ui-designer") {
    const pencilBinPath = "/Applications/Pencil.app/Contents/Resources/app.asar.unpacked/out/mcp-server-darwin-arm64";
    const pencilExists = fs.existsSync(pencilBinPath);

    if (pencilExists) {
      // Pencil MCP requires the Pencil GUI app to be running (IPC connection).
      // Without it: "app connection is required" error, all MCP calls timeout.
      //
      // IMPORTANT: Do NOT use `open file.pen` — Pencil is Electron and
      // treats file paths as URLs, showing dashboard (localhost:3000) in webview.
      //
      // Correct sequence:
      // 1. Launch Pencil app (without any file argument)
      // 2. Wait for it to initialize (3 seconds)
      // 3. Agent uses MCP open_document to create/open .pen file programmatically
      try {
        // Check if Pencil is already running
        const { execSync } = require("child_process");
        const isRunning = execSync("pgrep -x Pencil", { encoding: "utf-8", timeout: 2000 }).trim();
        if (!isRunning) throw new Error("not running");
      } catch {
        // Launch Pencil app (no file args — prevents webview URL loading)
        try {
          spawn("open", ["-a", "Pencil"], { detached: true, stdio: "ignore" }).unref();
        } catch { /* not installed */ }
      }

      const mcpConfig = JSON.stringify({
        mcpServers: {
          pencil: {
            command: pencilBinPath,
            args: [],
          },
        },
      });
      // Wait 3s for Pencil to fully initialize before Claude starts
      claudeCmd = `sleep 3 && cat "${tmpFile}" | claude --print --output-format json --model ${selectedModel} --dangerously-skip-permissions --mcp-config '${mcpConfig}'`;
    }
  }

  // Media agents get access to media-tools MCP (image/video/music generation)
  const MEDIA_AGENTS = new Set(["image-generator", "video-generator", "music-composer"]);
  if (MEDIA_AGENTS.has(agentId)) {
    const mediaServerPath = path.resolve(process.cwd(), "..", "mcp-servers", "media-generator", "server.js");
    if (fs.existsSync(mediaServerPath)) {
      const mcpConfig = JSON.stringify({
        mcpServers: {
          "media-tools": {
            command: "node",
            args: [mediaServerPath],
            env: {
              OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
              KLING_ACCESS_KEY: process.env.KLING_ACCESS_KEY || "",
              KLING_SECRET_KEY: process.env.KLING_SECRET_KEY || "",
              BEATOVEN_API_KEY: process.env.BEATOVEN_API_KEY || "",
              OUTPUT_DIR: outputDir,
            },
          },
        },
      });
      claudeCmd = `cat "${tmpFile}" | claude --print --output-format json --model ${selectedModel} --dangerously-skip-permissions --mcp-config '${mcpConfig}'`;
    }
  }

  // Code agents use external project_path as working directory (when set)
  let agentCwd = outputDir;
  if (state.project_path && CODE_AGENTS.has(agentId)) {
    if (fs.existsSync(state.project_path)) {
      agentCwd = state.project_path;
    } else {
      console.warn(`[spawnAgent] project_path "${state.project_path}" не существует, используем outputDir`);
    }
  }

  const child = spawn(
    "/bin/sh",
    ["-c", claudeCmd],
    {
      cwd: agentCwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true, // own process group so killAgent can kill -pgid
    }
  );

  // Save PID for stuck-process detection
  try {
    fs.writeFileSync(path.join(outputDir, "_pid"), String(child.pid || ""));
  } catch { /* ignore */ }

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

  child.on("close", (code) => {
    try { fs.unlinkSync(tmpFile); } catch { /* */ }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Parse JSON output from claude --output-format json FIRST
    let resultText = "";
    let usageData: import("./types").AgentUsage | null = null;

    try {
      const jsonResult = JSON.parse(stdout.trim());
      resultText = jsonResult.result || "";
      if (jsonResult.usage || jsonResult.total_cost_usd !== undefined) {
        const u = jsonResult.usage || {};
        const modelKeys = jsonResult.modelUsage ? Object.keys(jsonResult.modelUsage) : [];
        const modelName = modelKeys[0] || undefined;
        usageData = {
          input_tokens: u.input_tokens || 0,
          output_tokens: u.output_tokens || 0,
          cache_creation_tokens: u.cache_creation_input_tokens || 0,
          cache_read_tokens: u.cache_read_input_tokens || 0,
          cost_usd: jsonResult.total_cost_usd || 0,
          duration_ms: jsonResult.duration_ms || (Date.now() - startTime),
          model: modelName,
        };
      }

      // Save usage to a JSON file for easy access
      if (usageData) {
        const usageFile = path.join(outputDir, "_usage.json");
        fs.writeFileSync(usageFile, JSON.stringify(usageData, null, 2), "utf-8");
      }
    } catch {
      // Not valid JSON — use raw stdout
      resultText = stdout.trim();
    }

    // Save full execution log: prompt + output + stderr
    const logParts: string[] = [
      `# Лог выполнения: ${agentId}`,
      ``,
      `**Время запуска:** ${new Date(startTime).toISOString()}`,
      `**Длительность:** ${elapsed}с`,
      `**Код выхода:** ${code}`,
      ``,
      `---`,
      ``,
      `## Входные данные (промпт)`,
      ``,
      `<details>`,
      `<summary>Показать полный промпт (${promptContent.length} символов)</summary>`,
      ``,
      "```markdown",
      promptContent.length > 50000
        ? promptContent.slice(0, 50000) + "\n\n... [обрезано] ..."
        : promptContent,
      "```",
      `</details>`,
      ``,
    ];

    if (resultText || stdout.trim()) {
      logParts.push(
        `## Ответ модели`,
        ``,
        resultText || stdout.trim(),
        ``,
      );
    }

    if (usageData) {
      logParts.push(
        `## Использование токенов`,
        ``,
        `| Метрика | Значение |`,
        `|---------|----------|`,
        `| Модель | ${usageData.model || "—"} |`,
        `| Input tokens | ${usageData.input_tokens.toLocaleString()} |`,
        `| Output tokens | ${usageData.output_tokens.toLocaleString()} |`,
        `| Cache creation | ${usageData.cache_creation_tokens.toLocaleString()} |`,
        `| Cache read | ${usageData.cache_read_tokens.toLocaleString()} |`,
        `| Стоимость | $${usageData.cost_usd.toFixed(4)} |`,
        `| Длительность | ${(usageData.duration_ms / 1000).toFixed(1)}с |`,
        ``,
      );
    }

    if (stderr.trim()) {
      logParts.push(
        `## Stderr / Ошибки`,
        ``,
        "```",
        stderr.trim().slice(0, 5000),
        "```",
        ``,
      );
    }

    logParts.push(
      `---`,
      ``,
      `*Лог сохранён автоматически*`,
    );

    const logFile = path.join(outputDir, "_reasoning.md");
    fs.writeFileSync(logFile, logParts.join("\n"), "utf-8");

    // Copy key files to run directory for history
    try {
      fs.writeFileSync(path.join(runDir, "_reasoning.md"), logParts.join("\n"), "utf-8");
      if (usageData) {
        fs.writeFileSync(path.join(runDir, "_usage.json"), JSON.stringify(usageData, null, 2), "utf-8");
      }
      fs.writeFileSync(path.join(runDir, "_model.txt"), fs.readFileSync(path.join(outputDir, "_model.txt"), "utf-8"), "utf-8");
    } catch { /* ignore copy errors */ }

    // Check for rate limit / auth errors before finalizing
    const allOutput = (stderr + " " + stdout + " " + resultText).toLowerCase();
    const isRateLimit = allOutput.includes("rate limit") ||
      allOutput.includes("rate_limit") ||
      allOutput.includes("429") ||
      allOutput.includes("quota") ||
      allOutput.includes("too many requests") ||
      (allOutput.includes("403") && allOutput.includes("terminated")) ||
      allOutput.includes("token limit") ||
      allOutput.includes("billing");

    if (isRateLimit && code !== 0) {
      console.log(`[RateLimit] ${agentId}: rate limit detected, scheduling retry`);
      scheduleRateLimitRetry(id, agentId, allOutput.slice(0, 500));
      return; // Don't finalize — agent will be retried later
    }

    if (code === 0 && resultText) {
      const outputFile = path.join(outputDir, `${agentId}-output.md`);
      fs.writeFileSync(outputFile, resultText, "utf-8");
      finalizeAgent(id, agentId, true, undefined, usageData);
    } else if (code === 0) {
      finalizeAgent(id, agentId, true, undefined, usageData);
    } else {
      const errorParts: string[] = [];
      if (stderr.trim()) errorParts.push(stderr.trim());
      if (resultText) errorParts.push(resultText);
      const errorMsg = errorParts.join("\n\n") || `Процесс завершился с кодом ${code}`;
      finalizeAgent(id, agentId, false, errorMsg.slice(0, 3000), usageData);
    }
  });

  child.on("error", (err) => {
    try { fs.unlinkSync(tmpFile); } catch { /* */ }
    // Save error log
    const logFile = path.join(outputDir, "_reasoning.md");
    fs.writeFileSync(logFile, [
      `# Лог выполнения: ${agentId}`,
      ``,
      `**Ошибка запуска:** ${err.message}`,
      ``,
      `## Входные данные (промпт)`,
      ``,
      "```markdown",
      promptContent.slice(0, 10000),
      "```",
    ].join("\n"), "utf-8");
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

    const allDone = state.pipeline_type !== "debate" && state.pipeline_graph.nodes.length > 0 && state.pipeline_graph.nodes.every((n) => {
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

  // Kill existing process if running
  if (agent.status === "running") {
    killAgent(id, agentId);
  }

  agent.status = "running";
  agent.started_at = new Date().toISOString();
  agent.completed_at = null;
  agent.error = null;

  // Ensure pipeline is running
  if (state.status !== "running") {
    state.status = "running";
  }

  state.updated_at = new Date().toISOString();
  const filePath = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");

  // Actually spawn the agent
  spawnAgent(id, agentId, state);
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
 * Recursively collect all descendant PIDs of a process.
 */
function getDescendantPids(pid: number): number[] {
  const { execSync } = require("child_process");
  const result: number[] = [];
  try {
    const children = execSync(`pgrep -P ${pid} 2>/dev/null || true`, {
      encoding: "utf-8", timeout: 3000,
    }).trim().split("\n").filter(Boolean).map(Number).filter((n: number) => n > 0);
    for (const child of children) {
      result.push(child);
      result.push(...getDescendantPids(child));
    }
  } catch { /* */ }
  return result;
}

/**
 * Kill a running agent — terminate the ENTIRE process tree.
 *
 * claude spawns: /bin/sh → claude → /bin/zsh → docker compose build → ...
 * We must kill the full tree, bottom-up.
 */
export function killAgent(id: string, agentId: string): boolean {
  const state = getProjectState(id);
  if (!state) return false;
  const agent = state.agents[agentId];
  if (!agent) return false;
  // Don't check status — process may still be alive even if status changed

  const phase = AGENT_PHASES[agentId] || "other";
  const outputDir = path.join(PROJECTS_DIR, id, phase, agentId);
  const pidFile = path.join(outputDir, "_pid");
  const { execSync } = require("child_process");

  const allPids = new Set<number>();

  // 1. From PID file
  if (fs.existsSync(pidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim());
      if (pid > 0) {
        allPids.add(pid);
        for (const d of getDescendantPids(pid)) allPids.add(d);
      }
    } catch { /* */ }
  }

  // 2. By prompt file pattern (catches stale PID / restart cases)
  try {
    const pids = execSync(
      `pgrep -f "agent-prompt-${agentId}" 2>/dev/null || true`,
      { encoding: "utf-8", timeout: 3000 }
    ).trim().split("\n").filter(Boolean).map(Number);
    for (const pid of pids) {
      if (pid > 0) {
        allPids.add(pid);
        for (const d of getDescendantPids(pid)) allPids.add(d);
      }
    }
  } catch { /* */ }

  // 3. By CWD pattern — catches claude's spawned zsh/bash/docker subprocesses
  try {
    const cwdPath = outputDir.replace(/'/g, "'\\''");
    const pids = execSync(
      `lsof +D '${cwdPath}' 2>/dev/null | awk 'NR>1{print $2}' | sort -u || true`,
      { encoding: "utf-8", timeout: 5000 }
    ).trim().split("\n").filter(Boolean).map(Number);
    for (const pid of pids) {
      if (pid > 0) allPids.add(pid);
    }
  } catch { /* */ }

  // Kill all collected PIDs, bottom-up (children first)
  const sorted = Array.from(allPids).sort((a, b) => b - a);
  console.log(`[killAgent] ${agentId}: killing ${sorted.length} processes: ${sorted.join(", ")}`);
  for (const pid of sorted) {
    try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
  }

  agent.status = "failed";
  agent.started_at = null;
  agent.completed_at = new Date().toISOString();
  agent.error = "Принудительно остановлен";
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
// Удаление агента из pipeline (с автоматическим соединением разрывов)
// ============================================================================

export function removeAgentFromPipeline(id: string, agentId: string): {
  ok: boolean;
  error?: string;
} {
  const state = getProjectState(id);
  if (!state) return { ok: false, error: "Проект не найден" };

  // Don't remove running agents
  if (state.agents[agentId]?.status === "running") {
    return { ok: false, error: "Нельзя удалить работающего агента" };
  }

  // Find all edges involving this agent
  const incomingEdges = state.pipeline_graph.edges.filter(([, to]) => to === agentId);
  const outgoingEdges = state.pipeline_graph.edges.filter(([from]) => from === agentId);

  // Get predecessor and successor nodes
  const predecessors = incomingEdges.map(([from]) => from);
  const successors = outgoingEdges.map(([, to]) => to);

  // Remove all edges involving this agent
  state.pipeline_graph.edges = state.pipeline_graph.edges.filter(
    ([from, to]) => from !== agentId && to !== agentId
  );

  // Connect predecessors to successors (bridge the gap)
  for (const pred of predecessors) {
    for (const succ of successors) {
      // Avoid duplicate edges
      const exists = state.pipeline_graph.edges.some(
        ([f, t]) => f === pred && t === succ
      );
      if (!exists) {
        state.pipeline_graph.edges.push([pred, succ]);
      }
    }
  }

  // Remove from nodes list
  state.pipeline_graph.nodes = state.pipeline_graph.nodes.filter(n => n !== agentId);

  // Remove from parallel groups
  state.pipeline_graph.parallel_groups = state.pipeline_graph.parallel_groups
    .map(group => group.filter(n => n !== agentId))
    .filter(group => group.length > 0);

  // Remove from all schema-v2 blocks (agents + edges)
  if (Array.isArray(state.blocks)) {
    for (const b of state.blocks) {
      b.agents = b.agents.filter((a) => a !== agentId);
      b.edges = b.edges.filter(([s, t]) => s !== agentId && t !== agentId);
    }
  }

  // Remove agent state
  delete state.agents[agentId];

  state.updated_at = new Date().toISOString();
  saveProjectState(id, state);

  return { ok: true };
}

// ============================================================================
// Block CRUD operations
// ============================================================================

export function resolveBlockApproval(
  id: string,
  blockId: string,
  decision: "go" | "stop",
  notes?: string
): boolean {
  const state = getProjectState(id);
  if (!state) return false;

  const block = state.blocks?.find((b) => b.id === blockId);
  if (!block) return false;

  block.approval = {
    decision,
    decided_by: "human",
    timestamp: new Date().toISOString(),
    notes,
  };

  if (decision === "stop") {
    state.status = "stopped";
    // Mark remaining pending agents as skipped
    for (const agent of Object.values(state.agents)) {
      if (agent.status === "pending") agent.status = "skipped";
    }
  } else {
    state.status = "running";
  }

  state.current_gate = null;
  state.updated_at = new Date().toISOString();
  const filePath = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  return true;
}

export function addBlock(
  id: string,
  name: string,
  description?: string,
  requiresApproval: boolean = true,
  afterBlockId?: string
): boolean {
  const state = getProjectState(id);
  if (!state || !state.blocks) return false;

  const blockId = name.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-|-$/g, "") || `block-${Date.now()}`;

  const newBlock: import("./types").PipelineBlock = {
    id: blockId,
    name,
    description,
    agents: [],
    edges: [],
    requires_approval: requiresApproval,
    depends_on: [],
  };

  if (afterBlockId) {
    const idx = state.blocks.findIndex((b) => b.id === afterBlockId);
    if (idx >= 0) {
      state.blocks.splice(idx + 1, 0, newBlock);
    } else {
      state.blocks.push(newBlock);
    }
  } else {
    state.blocks.push(newBlock);
  }

  state.updated_at = new Date().toISOString();
  const filePath = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  return true;
}

export function removeBlock(id: string, blockId: string): boolean {
  const state = getProjectState(id);
  if (!state || !state.blocks) return false;

  const idx = state.blocks.findIndex((b) => b.id === blockId);
  if (idx < 0) return false;

  state.blocks.splice(idx, 1);
  state.updated_at = new Date().toISOString();
  const filePath = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  return true;
}

export function updateBlock(
  id: string,
  blockId: string,
  updates: { name?: string; description?: string; requires_approval?: boolean }
): boolean {
  const state = getProjectState(id);
  if (!state || !state.blocks) return false;

  const block = state.blocks.find((b) => b.id === blockId);
  if (!block) return false;

  if (updates.name !== undefined) block.name = updates.name;
  if (updates.description !== undefined) block.description = updates.description;
  if (updates.requires_approval !== undefined) block.requires_approval = updates.requires_approval;

  state.updated_at = new Date().toISOString();
  const filePath = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  return true;
}

export function reorderBlocks(id: string, blockIds: string[]): boolean {
  const state = getProjectState(id);
  if (!state || !state.blocks) return false;

  const blockMap = new Map(state.blocks.map((b) => [b.id, b]));
  const reordered: import("./types").PipelineBlock[] = [];
  for (const bid of blockIds) {
    const block = blockMap.get(bid);
    if (block) reordered.push(block);
  }
  // Add any blocks not in the provided order
  for (const block of state.blocks) {
    if (!blockIds.includes(block.id)) reordered.push(block);
  }

  state.blocks = reordered;
  state.updated_at = new Date().toISOString();
  const filePath = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  return true;
}

export function addAgentToBlock(id: string, blockId: string, agentId: string): boolean {
  const state = getProjectState(id);
  if (!state || !state.blocks) return false;

  const block = state.blocks.find((b) => b.id === blockId);
  if (!block) return false;
  if (block.agents.includes(agentId)) return true; // already there

  block.agents.push(agentId);

  // Add to pipeline_graph if not there
  if (!state.pipeline_graph.nodes.includes(agentId)) {
    state.pipeline_graph.nodes.push(agentId);
  }

  // Initialize agent state if needed
  if (!state.agents[agentId]) {
    state.agents[agentId] = {
      status: "pending",
      started_at: null,
      completed_at: null,
      artifacts: [],
      error: null,
    };
  }

  state.updated_at = new Date().toISOString();
  const filePath = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  return true;
}

export function removeAgentFromBlock(id: string, blockId: string, agentId: string): boolean {
  const state = getProjectState(id);
  if (!state || !state.blocks) return false;

  const block = state.blocks.find((b) => b.id === blockId);
  if (!block) return false;

  block.agents = block.agents.filter((a) => a !== agentId);
  block.edges = block.edges.filter(([s, t]) => s !== agentId && t !== agentId);

  state.updated_at = new Date().toISOString();
  const filePath = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  return true;
}

// ============================================================================
// Cycle management & scheduling
// ============================================================================

export function restartCycle(id: string): boolean {
  const state = getProjectState(id);
  if (!state) return false;

  // Record current cycle in history if there are any completed/running agents
  const hasActivity = Object.values(state.agents).some(
    (a) => a.status !== "pending"
  );
  if (hasActivity) {
    const cycleRecord = {
      cycle: state.current_cycle || 1,
      started_at: state.created_at,
      completed_at: new Date().toISOString(),
      status: (state.status === "completed" ? "completed" : state.status === "failed" ? "failed" : "running") as "completed" | "failed" | "running",
    };
    if (!state.cycle_history) state.cycle_history = [];
    state.cycle_history.push(cycleRecord);
  }

  // Increment cycle
  state.current_cycle = (state.current_cycle || 1) + 1;

  // Reset all agents to pending
  for (const agent of Object.values(state.agents)) {
    agent.status = "pending";
    agent.started_at = null;
    agent.completed_at = null;
    agent.error = null;
    // Keep usage_history and artifacts for history
  }

  // Reset all block approvals
  if (state.blocks) {
    for (const block of state.blocks) {
      delete block.approval;
    }
  }

  state.status = "running";
  state.current_gate = null;
  state.updated_at = new Date().toISOString();

  const filePath = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  return true;
}

export function updateSchedule(
  id: string,
  schedule: { preset: string; cron?: string; enabled: boolean }
): boolean {
  const state = getProjectState(id);
  if (!state) return false;

  state.schedule = schedule as any;
  state.updated_at = new Date().toISOString();

  const filePath = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  return true;
}

export function updateBlockEdges(
  id: string,
  blockId: string,
  edges: [string, string][]
): boolean {
  const state = getProjectState(id);
  if (!state || !state.blocks) return false;

  const block = state.blocks.find((b) => b.id === blockId);
  if (!block) return false;

  // Validate: all edge nodes must be in this block
  const agentSet = new Set(block.agents);
  for (const [src, tgt] of edges) {
    if (!agentSet.has(src) || !agentSet.has(tgt)) return false;
  }

  block.edges = edges;
  state.updated_at = new Date().toISOString();

  const filePath = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  return true;
}

export function updateBlockDeps(
  id: string,
  blockId: string,
  dependsOn: string[]
): boolean {
  const state = getProjectState(id);
  if (!state || !state.blocks) return false;

  const block = state.blocks.find((b) => b.id === blockId);
  if (!block) return false;

  block.depends_on = dependsOn;
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
