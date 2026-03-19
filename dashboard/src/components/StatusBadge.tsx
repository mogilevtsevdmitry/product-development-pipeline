"use client";

import type { AgentStatus, ProjectStatus } from "@/lib/types";

const STATUS_CONFIG: Record<
  string,
  { color: string; bg: string; label: string }
> = {
  completed: {
    color: "bg-emerald-400",
    bg: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20",
    label: "Завершён",
  },
  running: {
    color: "bg-blue-400",
    bg: "bg-blue-400/10 text-blue-400 border-blue-400/20",
    label: "Выполняется",
  },
  pending: {
    color: "bg-gray-400",
    bg: "bg-gray-400/10 text-gray-400 border-gray-400/20",
    label: "Ожидает",
  },
  skipped: {
    color: "bg-gray-500",
    bg: "bg-gray-500/10 text-gray-500 border-gray-500/20",
    label: "Пропущен",
  },
  failed: {
    color: "bg-red-400",
    bg: "bg-red-400/10 text-red-400 border-red-400/20",
    label: "Ошибка",
  },
  paused_at_gate: {
    color: "bg-amber-400",
    bg: "bg-amber-400/10 text-amber-400 border-amber-400/20",
    label: "Ожидает решения",
  },
  paused: {
    color: "bg-yellow-400",
    bg: "bg-yellow-400/10 text-yellow-400 border-yellow-400/20",
    label: "На паузе",
  },
  stopped: {
    color: "bg-gray-400",
    bg: "bg-gray-400/10 text-gray-400 border-gray-400/20",
    label: "Остановлен",
  },
  created: {
    color: "bg-indigo-400",
    bg: "bg-indigo-400/10 text-indigo-400 border-indigo-400/20",
    label: "Создан",
  },
};

interface StatusBadgeProps {
  status: AgentStatus | ProjectStatus;
  size?: "sm" | "md";
}

export default function StatusBadge({
  status,
  size = "md",
}: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const isRunning = status === "running";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${
        config.bg
      } ${size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"}`}
    >
      <span
        className={`inline-block rounded-full ${config.color} ${
          size === "sm" ? "w-1.5 h-1.5" : "w-2 h-2"
        } ${isRunning ? "animate-pulse-dot" : ""}`}
      />
      {config.label}
    </span>
  );
}
