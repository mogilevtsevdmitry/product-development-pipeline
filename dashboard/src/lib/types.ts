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
  edges: (readonly [string, string] | readonly [string, string, string[]])[];
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
  depends_on: string[];           // IDs of blocks this block depends on (DAG)
  requires_approval: boolean;
  approval?: BlockApproval;
}

// --- Schedule & Cycles ---

export type SchedulePreset = "hourly" | "daily" | "weekly" | "custom";

export interface ProjectSchedule {
  preset: SchedulePreset;
  cron?: string;                  // for "custom" preset
  enabled: boolean;
}

export interface CycleRecord {
  cycle: number;
  started_at: string;
  completed_at?: string;
  status: "completed" | "failed" | "running";
}

// --- Block status computation ---

/**
 * Compute all block statuses at once (needed for DAG deps).
 * Returns a map of blockId → BlockStatus.
 */
export function computeAllBlockStatuses(
  blocks: PipelineBlock[],
  agents: Record<string, AgentState>
): Record<string, BlockStatus> {
  const result: Record<string, BlockStatus> = {};

  // Topological iteration: compute blocks with no unresolved deps first
  const remaining = new Set(blocks.map((b) => b.id));
  const blockMap = new Map(blocks.map((b) => [b.id, b]));

  // Multiple passes until all resolved (safe for DAGs)
  let changed = true;
  while (changed) {
    changed = false;
    for (const blockId of remaining) {
      const block = blockMap.get(blockId)!;
      const deps = block.depends_on || [];
      const depsResolved = deps.every((depId) => depId in result);
      if (!depsResolved) continue;

      const blockAgents = block.agents.map((id) => agents[id]).filter(Boolean);

      if (blockAgents.length === 0) {
        result[blockId] = "pending";
        remaining.delete(blockId);
        changed = true;
        continue;
      }

      const hasRunning = blockAgents.some((a) => a.status === "running");
      const hasFailed = blockAgents.some((a) => a.status === "failed");
      const allDone = blockAgents.every(
        (a) => a.status === "completed" || a.status === "skipped"
      );

      if (hasFailed) {
        result[blockId] = "failed";
      } else if (allDone && block.requires_approval && !block.approval) {
        result[blockId] = "awaiting_approval";
      } else if (allDone) {
        result[blockId] = "completed";
      } else if (hasRunning) {
        result[blockId] = "running";
      } else {
        // Check if all dependency blocks are completed
        const allDepsCompleted = deps.every(
          (depId) => result[depId] === "completed"
        );
        result[blockId] = allDepsCompleted ? "pending" : "blocked";
      }

      remaining.delete(blockId);
      changed = true;
    }
  }

  // Any remaining blocks (circular deps or broken refs) → blocked
  for (const blockId of remaining) {
    result[blockId] = "blocked";
  }

  return result;
}

// Legacy single-block computation (kept for backward compat)
export function computeBlockStatus(
  block: PipelineBlock,
  agents: Record<string, AgentState>,
  prevBlockStatus?: BlockStatus
): BlockStatus {
  return computeAllBlockStatuses(
    [block],
    agents
  )[block.id] || "pending";
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
  // Schedule & cycles
  schedule?: ProjectSchedule;
  current_cycle: number;
  cycle_history: CycleRecord[];
  // Legacy (schema v1, kept for migration)
  pipeline_graph: PipelineGraph;
  agents: Record<string, AgentState>;
  gate_decisions: Record<string, GateDecision | null>;
  // Artifact filters: key = "dep_agent→target_agent", value = allowed filenames or null (pass all)
  artifact_filters?: Record<string, string[] | null>;
  // Web project detection & Docker preview
  is_web_project?: boolean;
  preview?: PreviewState;
  // Auto-advance: skip block approvals, run pipeline end-to-end
  auto_advance?: boolean;
  // Pipeline type: standard (DAG blocks) or debate (AgentHQ 3-agent cycle)
  pipeline_type?: "standard" | "debate";
  debate?: DebateState;
  schema_version: number;
}

// --- Preview State ---

export type PreviewStatus = "starting" | "running" | "failed" | "stopped";

export interface PreviewState {
  status: PreviewStatus;
  url?: string;
  ports?: { app: number; db?: number };
  compose_file?: string;
  started_at?: string;
  error?: string;
  logs?: string;
}

// --- Debate (AgentHQ) State ---

export type DebateStatus = "idle" | "running" | "completed" | "deadlocked";
export type DebateAgentRole = "analyst" | "producer" | "controller";
export type DebateVerdict = "sign-off" | "issues" | "blocker";

export interface DebateAgentOutput {
  output: string;
  timestamp: string;
}

export interface DebateAnalystOutput extends DebateAgentOutput {
  focus: string;
}

export interface DebateControllerOutput extends DebateAgentOutput {
  verdict: DebateVerdict;
  issues?: string[];
}

export interface DebateRound {
  round: number;
  analyst?: DebateAnalystOutput;
  producer?: DebateAgentOutput;
  controller?: DebateControllerOutput;
}

export interface DebateRoles {
  analyst: string;   // agent id, e.g. "product-owner"
  producer: string;  // agent id, e.g. "content-creator"
  controller: string; // agent id, e.g. "qa-engineer"
}

export interface DebateState {
  task: string;
  roles: DebateRoles;
  current_round: number;
  max_rounds: number;
  status: DebateStatus;
  current_agent?: DebateAgentRole;
  rounds: DebateRound[];
}
