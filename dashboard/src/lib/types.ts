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

export interface AgentUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  duration_ms: number;
  model?: string;
}

export interface FeedbackItem {
  from_agent: string;       // кто нашёл проблему (qa-engineer, security-engineer, devops-engineer)
  to_agent: string;         // кому вернуть (backend-developer, frontend-developer, devops-engineer)
  severity: "critical" | "high" | "medium" | "low";
  description: string;      // описание проблемы
  created_at: string;
  resolved: boolean;
  resolved_at?: string;
}

export interface AgentRunRecord {
  run_number: number;
  started_at: string;
  completed_at?: string;
  status: "completed" | "failed" | "running";
  usage?: AgentUsage | null;
  error?: string | null;
  artifacts: string[];              // list of artifact filenames for this run
  run_dir: string;                  // relative path to run folder (e.g., "runs/001")
}

export interface AgentState {
  status: AgentStatus;
  started_at?: string | null;
  completed_at?: string | null;
  artifacts: string[];
  error?: string | null;
  usage?: AgentUsage | null;
  usage_history?: AgentUsage[];  // all runs (including retries/restarts)
  total_usage?: AgentUsage | null;  // sum of all runs
  feedback_sent?: FeedbackItem[];     // проблемы, найденные этим агентом
  feedback_received?: FeedbackItem[]; // проблемы, полученные от других агентов
  run_history?: AgentRunRecord[];     // история всех запусков
  current_run?: number;               // текущий номер запуска
}

// --- Pipeline Graph (legacy, schema v1) ---

export interface PipelineGraph {
  nodes: string[];
  edges: [string, string][];
  parallel_groups: string[][];
}

// --- Pipeline Blocks (schema v2) ---

export type BlockStatus =
  | "completed"
  | "running"
  | "pending"
  | "blocked"
  | "awaiting_approval"
  | "failed";

export interface BlockApproval {
  decision: "go" | "stop";
  decided_by: string;
  timestamp: string;
  notes?: string;
}

export interface PipelineBlock {
  id: string;
  name: string;
  description?: string;
  agents: string[];
  edges: [string, string][];
  requires_approval: boolean;
  approval?: BlockApproval;
}

// --- Block status computation ---

export function computeBlockStatus(
  block: PipelineBlock,
  agents: Record<string, AgentState>,
  prevBlockStatus?: BlockStatus
): BlockStatus {
  const blockAgents = block.agents.map((id) => agents[id]).filter(Boolean);
  if (blockAgents.length === 0) return "pending";

  const hasRunning = blockAgents.some((a) => a.status === "running");
  const hasFailed = blockAgents.some((a) => a.status === "failed");
  const allDone = blockAgents.every(
    (a) => a.status === "completed" || a.status === "skipped"
  );

  if (hasFailed) return "failed";
  if (allDone && block.requires_approval && !block.approval) return "awaiting_approval";
  if (allDone) return "completed";
  if (hasRunning) return "running";

  // Check if blocked by previous block
  if (prevBlockStatus && prevBlockStatus !== "completed") return "blocked";

  return "pending";
}

// --- Project State ---

export interface ProjectState {
  project_id: string;
  name: string;
  description: string;
  project_path?: string;
  created_at: string;
  updated_at: string;
  mode: PipelineMode;
  status: ProjectStatus;
  current_gate: GateType | string | null;
  // Schema v2: blocks-based pipeline
  blocks: PipelineBlock[];
  // Legacy (schema v1, kept for migration)
  pipeline_graph: PipelineGraph;
  agents: Record<string, AgentState>;
  gate_decisions: Record<string, GateDecision | null>;
  schema_version: number;
}
