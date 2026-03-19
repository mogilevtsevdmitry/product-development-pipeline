"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export interface AgentNodeData {
  label: string;
  phase: string;
  status: "completed" | "running" | "pending" | "skipped" | "failed";
  type?: "agent" | "gate";
  [key: string]: unknown;
}

const STATUS_STYLES: Record<string, { border: string; bg: string; dot: string }> = {
  pending: {
    border: "border-gray-600",
    bg: "bg-gray-800",
    dot: "bg-gray-400",
  },
  running: {
    border: "border-blue-500",
    bg: "bg-blue-950/50",
    dot: "bg-blue-400",
  },
  completed: {
    border: "border-emerald-500",
    bg: "bg-emerald-950/50",
    dot: "bg-emerald-400",
  },
  failed: {
    border: "border-red-500",
    bg: "bg-red-950/50",
    dot: "bg-red-400",
  },
  skipped: {
    border: "border-gray-600 border-dashed",
    bg: "bg-gray-900",
    dot: "bg-gray-500",
  },
};

const PHASE_COLORS: Record<string, string> = {
  research: "text-violet-400",
  product: "text-blue-400",
  meta: "text-cyan-400",
  legal: "text-orange-400",
  design: "text-emerald-400",
  development: "text-sky-400",
  quality: "text-amber-400",
  release: "text-rose-400",
  marketing: "text-pink-400",
  feedback: "text-teal-400",
};

function AgentNodeComponent({ data }: NodeProps) {
  const nodeData = data as unknown as AgentNodeData;
  const style = STATUS_STYLES[nodeData.status] ?? STATUS_STYLES.pending;
  const isGate = nodeData.type === "gate";
  const phaseColor = PHASE_COLORS[nodeData.phase] ?? "text-gray-400";

  return (
    <div
      className={`relative rounded-lg border-2 ${style.border} ${style.bg} px-4 py-3 min-w-[160px] max-w-[200px] shadow-lg ${
        isGate ? "rounded-xl border-amber-500/60 bg-amber-950/30" : ""
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-gray-500 !w-2 !h-2 !border-0"
      />

      <div className="flex items-center gap-2 mb-1">
        <span
          className={`w-2 h-2 rounded-full ${style.dot} shrink-0 ${
            nodeData.status === "running" ? "animate-pulse-dot" : ""
          }`}
        />
        <span className="text-sm font-medium text-white truncate leading-tight">
          {nodeData.label}
        </span>
      </div>

      <div className={`text-xs ${phaseColor} font-medium`}>
        {isGate ? "🚦 Гейт" : nodeData.phase}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-gray-500 !w-2 !h-2 !border-0"
      />
    </div>
  );
}

export default memo(AgentNodeComponent);
