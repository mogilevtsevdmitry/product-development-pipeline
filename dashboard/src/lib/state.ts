import fs from "fs";
import path from "path";
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
    status: "running",
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
