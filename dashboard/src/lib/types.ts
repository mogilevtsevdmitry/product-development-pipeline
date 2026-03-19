// --- Enums / Unions ---

export type AgentStatus =
  | "completed"
  | "running"
  | "pending"
  | "skipped"
  | "failed";

export type PipelineMode = "auto" | "human_approval";

export type ProjectStatus =
  | "created"
  | "running"
  | "paused_at_gate"
  | "paused"
  | "stopped"
  | "completed"
  | "failed";

// --- Gate Decisions ---
// Совпадает с Python orchestrator gates.py

export type GateType =
  | "gate_1_build"
  | "gate_2_architecture"
  | "gate_3_go_nogo";

export type GateDecisionValue =
  | "go"
  | "pivot"
  | "stop"
  | "revise"
  | "no-go"
  | "rollback";

export interface GateDecision {
  decision: GateDecisionValue;
  decided_by: string;
  timestamp: string;
  notes?: string;
}

export const GATE_DECISIONS: Record<GateType, GateDecisionValue[]> = {
  gate_1_build: ["go", "pivot", "stop"],
  gate_2_architecture: ["go", "revise", "stop"],
  gate_3_go_nogo: ["go", "no-go", "rollback"],
};

export const GATE_LABELS: Record<GateType, string> = {
  gate_1_build: "Gate 1: Строим?",
  gate_2_architecture: "Gate 2: Архитектура",
  gate_3_go_nogo: "Gate 3: Go / No-go",
};

// --- Agent State ---

export interface AgentState {
  status: AgentStatus;
  started_at?: string | null;
  completed_at?: string | null;
  artifacts: string[];
  error?: string | null;
}

// --- Pipeline Graph ---

export interface PipelineGraph {
  nodes: string[];
  edges: [string, string][];
  parallel_groups: string[][];
}

// --- Project State ---
// Совпадает с Python orchestrator engine.py create_project()

export interface ProjectState {
  project_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  mode: PipelineMode;
  status: ProjectStatus;
  current_gate: GateType | string | null;
  pipeline_graph: PipelineGraph;
  agents: Record<string, AgentState>;
  gate_decisions: Record<string, GateDecision | null>;
  schema_version: number;
}
