// --- Enums / Unions ---

export type AgentStatus =
  | "completed"
  | "running"
  | "pending"
  | "skipped"
  | "failed";

export type PipelineMode = "auto" | "human_approval";

export type ProjectStatus =
  | "running"
  | "paused_at_gate"
  | "completed"
  | "failed";

// --- Gate Decisions ---

export type Gate1Decision = "go" | "pivot" | "stop";
export type Gate2Decision = "go" | "narrow" | "stop";
export type Gate3Decision = "go" | "iterate" | "stop";

export type GateType = "gate_1" | "gate_2" | "gate_3";

export interface GateDecision {
  gate: GateType;
  decision: Gate1Decision | Gate2Decision | Gate3Decision;
  decided_by: string;
  decided_at: string;
  notes?: string;
}

// --- Agent State ---

export interface AgentArtifact {
  name: string;
  path: string;
  type?: string;
}

export interface AgentState {
  status: AgentStatus;
  phase?: string;
  started_at?: string;
  completed_at?: string;
  artifacts: AgentArtifact[];
  error?: string;
  depends_on?: string[];
}

// --- Pipeline Graph ---

export interface PipelineNode {
  id: string;
  label: string;
  phase: string;
  type?: "agent" | "gate";
}

export interface PipelineEdge {
  source: string;
  target: string;
}

export interface PipelineGraph {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  parallel_groups?: Record<string, string[]>;
}

// --- Project State ---

export interface ProjectState {
  schema_version: string;
  project_id: string;
  project_name: string;
  mode: PipelineMode;
  status: ProjectStatus;
  current_gate?: GateType | null;
  created_at: string;
  updated_at: string;
  pipeline_graph: PipelineGraph;
  agents: Record<string, AgentState>;
  gate_decisions: GateDecision[];
}
