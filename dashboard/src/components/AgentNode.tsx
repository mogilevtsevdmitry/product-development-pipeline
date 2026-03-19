"use client";

import { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export interface AgentNodeData {
  label: string;
  phase: string;
  status: "completed" | "running" | "pending" | "skipped" | "failed";
  projectId?: string;
  [key: string]: unknown;
}

const STATUS_STYLES: Record<string, { border: string; bg: string; dot: string }> = {
  pending: { border: "border-gray-600", bg: "bg-gray-800", dot: "bg-gray-400" },
  running: { border: "border-blue-500", bg: "bg-blue-950/50", dot: "bg-blue-400" },
  completed: { border: "border-emerald-500", bg: "bg-emerald-950/50", dot: "bg-emerald-400" },
  failed: { border: "border-red-500", bg: "bg-red-950/50", dot: "bg-red-400" },
  skipped: { border: "border-gray-600 border-dashed", bg: "bg-gray-900", dot: "bg-gray-500" },
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

function AgentNodeComponent({ id, data }: NodeProps) {
  const nodeData = data as unknown as AgentNodeData;
  const style = STATUS_STYLES[nodeData.status] ?? STATUS_STYLES.pending;
  const phaseColor = PHASE_COLORS[nodeData.phase] ?? "text-gray-400";
  const [hovered, setHovered] = useState(false);
  const [loading, setLoading] = useState(false);

  const projectId = nodeData.projectId;

  async function sendAction(action: string) {
    if (!projectId || loading) return;
    setLoading(true);
    try {
      await fetch(`/api/state/${projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, agentId: id }),
      });
    } finally {
      setLoading(false);
    }
  }

  const showControls = hovered && projectId && !loading;
  const status = nodeData.status;

  return (
    <div
      className={`relative rounded-lg border-2 ${style.border} ${style.bg} px-4 py-3 min-w-[160px] max-w-[220px] shadow-lg`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-gray-500 !w-2 !h-2 !border-0"
      />

      {/* Hover controls */}
      {showControls && (
        <div className="absolute -top-9 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-gray-900 border border-gray-700 rounded-lg px-1.5 py-1 shadow-xl z-50">
          {status === "running" && (
            <button
              onClick={(e) => { e.stopPropagation(); sendAction("pause_agent"); }}
              className="p-1 rounded hover:bg-yellow-500/20 text-yellow-400 text-xs"
              title="Пауза"
            >
              ⏸
            </button>
          )}
          {(status === "pending" || status === "failed" || status === "skipped") && (
            <button
              onClick={(e) => { e.stopPropagation(); sendAction("run_agent"); }}
              className="p-1 rounded hover:bg-emerald-500/20 text-emerald-400 text-xs"
              title="Запустить"
            >
              ▶
            </button>
          )}
          {(status === "completed" || status === "failed") && (
            <button
              onClick={(e) => { e.stopPropagation(); sendAction("restart_agent"); }}
              className="p-1 rounded hover:bg-blue-500/20 text-blue-400 text-xs"
              title="Перезапустить"
            >
              🔄
            </button>
          )}
        </div>
      )}

      {loading && (
        <div className="absolute -top-9 left-1/2 -translate-x-1/2 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 shadow-xl z-50">
          <span className="text-xs text-gray-400">⏳</span>
        </div>
      )}

      <div className="flex items-center gap-2 mb-1">
        <span
          className={`w-2 h-2 rounded-full ${style.dot} shrink-0 ${
            status === "running" ? "animate-pulse-dot" : ""
          }`}
        />
        <span className="text-sm font-medium text-white truncate leading-tight">
          {nodeData.label}
        </span>
      </div>

      <div className={`text-xs ${phaseColor} font-medium`}>
        {nodeData.phase}
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
