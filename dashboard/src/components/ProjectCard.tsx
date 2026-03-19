"use client";

import Link from "next/link";
import StatusBadge from "./StatusBadge";
import type { ProjectStatus } from "@/lib/types";

interface ProjectCardProps {
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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const GATE_DISPLAY: Record<string, string> = {
  gate_1_build: "🚦 Строим?",
  gate_2_architecture: "🏗️ Архитектура",
  gate_3_go_nogo: "🚀 Go / No-go",
};

export default function ProjectCard({
  project_id,
  name,
  description,
  status,
  mode,
  created_at,
  current_gate,
  agents_total,
  agents_completed,
}: ProjectCardProps) {
  const progress =
    agents_total > 0 ? Math.round((agents_completed / agents_total) * 100) : 0;

  return (
    <Link href={`/project/${project_id}`}>
      <div className="group rounded-xl border border-gray-800 bg-gray-900 p-5 hover:border-gray-700 hover:bg-gray-800/80 transition-all cursor-pointer">
        <div className="flex items-start justify-between mb-2">
          <h3 className="font-semibold text-lg text-white group-hover:text-blue-400 transition-colors">
            {name}
          </h3>
          <StatusBadge status={status as ProjectStatus} size="sm" />
        </div>

        {description && (
          <p className="text-sm text-gray-500 mb-3 line-clamp-2">
            {description}
          </p>
        )}

        {/* Progress bar */}
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>
              {agents_completed} / {agents_total} агентов
            </span>
            <span>{progress}%</span>
          </div>
          <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="space-y-1.5 text-sm text-gray-400">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Режим:</span>
            <span
              className={
                mode === "human_approval"
                  ? "text-amber-400"
                  : "text-emerald-400"
              }
            >
              {mode === "human_approval" ? "👤 Ручной" : "🤖 Авто"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-gray-500">Создан:</span>
            <span>{formatDate(created_at)}</span>
          </div>

          {current_gate && (
            <div className="flex items-center gap-2">
              <span className="text-amber-400 font-medium">
                {GATE_DISPLAY[current_gate] || current_gate}
              </span>
            </div>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-gray-800 flex items-center justify-between">
          <span className="text-xs text-gray-500 font-mono">{project_id}</span>
          <span className="text-xs text-gray-500 group-hover:text-gray-300 transition-colors">
            Открыть →
          </span>
        </div>
      </div>
    </Link>
  );
}
