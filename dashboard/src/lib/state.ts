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
  const state = JSON.parse(raw) as ProjectState;

  // Auto-recover stuck agents: running for >10 min with no process
  let stateChanged = false;
  const now = Date.now();
  const STUCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

  for (const [agentId, agent] of Object.entries(state.agents)) {
    if (agent.status !== "running" || !agent.started_at) continue;

    const elapsed = now - new Date(agent.started_at).getTime();
    if (elapsed < STUCK_TIMEOUT_MS) continue;

    // Check if output file exists — agent may have completed but callback missed
    const phase = getAgentPhase(agentId);
    const outDir = path.join(PROJECTS_DIR, id, phase, agentId);
    const outputFile = path.join(outDir, `${agentId}-output.md`);

    if (fs.existsSync(outputFile) && fs.statSync(outputFile).size > 0) {
      // Agent completed but callback was lost — recover
      agent.status = "completed";
      agent.completed_at = new Date(fs.statSync(outputFile).mtimeMs).toISOString();
      agent.artifacts = collectArtifacts(outDir, path.join(PROJECTS_DIR, id));
      stateChanged = true;
    } else {
      // No output — check if process is still alive
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

  if (stateChanged) {
    state.updated_at = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  }

  return state;
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

  // Save the prompt as _prompt.md so we can view it later (reasoning tab)
  const promptContent = fs.readFileSync(tmpFile, "utf-8");
  const promptLogFile = path.join(outputDir, "_prompt.md");
  fs.writeFileSync(promptLogFile, promptContent, "utf-8");

  const startTime = Date.now();

  const child = spawn(
    "/bin/sh",
    ["-c", `cat "${tmpFile}" | claude --print --output-format json --dangerously-skip-permissions`],
    {
      cwd: outputDir,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
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

    // Parse JSON output from claude --output-format json
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
