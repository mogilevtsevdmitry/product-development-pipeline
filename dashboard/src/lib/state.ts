import fs from "fs";
import path from "path";
import type { ProjectState, GateType } from "./types";

const STATE_DIR = path.resolve(
  process.cwd(),
  "..",
  "orchestrator",
  "state"
);

function ensureStateDir(): void {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

export function getProjectState(id: string): ProjectState | null {
  ensureStateDir();
  const filePath = path.join(STATE_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as ProjectState;
}

export interface ProjectSummary {
  project_id: string;
  project_name: string;
  status: string;
  mode: string;
  created_at: string;
  updated_at: string;
  current_gate?: string | null;
}

export function listProjects(): ProjectSummary[] {
  ensureStateDir();
  const files = fs.readdirSync(STATE_DIR).filter((f) => f.endsWith(".json"));
  const projects: ProjectSummary[] = [];

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(STATE_DIR, file), "utf-8");
      const state = JSON.parse(raw) as ProjectState;
      projects.push({
        project_id: state.project_id,
        project_name: state.project_name,
        status: state.status,
        mode: state.mode,
        created_at: state.created_at,
        updated_at: state.updated_at,
        current_gate: state.current_gate,
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

export function resolveGate(
  id: string,
  gate: GateType,
  decision: string,
  notes?: string
): boolean {
  const state = getProjectState(id);
  if (!state) return false;

  state.gate_decisions.push({
    gate,
    decision: decision as "go" | "pivot" | "stop",
    decided_by: "human",
    decided_at: new Date().toISOString(),
    notes,
  });

  if (decision !== "stop") {
    state.status = "running";
    state.current_gate = null;
  } else {
    state.status = "failed";
  }

  state.updated_at = new Date().toISOString();

  const filePath = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  return true;
}
