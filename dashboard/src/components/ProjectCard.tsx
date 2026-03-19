"use client";

import Link from "next/link";
import StatusBadge from "./StatusBadge";
import type { ProjectStatus, PipelineMode } from "@/lib/types";

interface ProjectCardProps {
  project_id: string;
  project_name: string;
  status: string;
  mode: string;
  created_at: string;
  updated_at: string;
  current_gate?: string | null;
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

export default function ProjectCard({
  project_id,
  project_name,
  status,
  mode,
  created_at,
  current_gate,
}: ProjectCardProps) {
  return (
    <Link href={`/project/${project_id}`}>
      <div className="group rounded-xl border border-gray-800 bg-gray-900 p-5 hover:border-gray-700 hover:bg-gray-800/80 transition-all cursor-pointer">
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-semibold text-lg text-white group-hover:text-blue-400 transition-colors">
            {project_name}
          </h3>
          <StatusBadge status={status as ProjectStatus} size="sm" />
        </div>

        <div className="space-y-2 text-sm text-gray-400">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Режим:</span>
            <span
              className={`${
                mode === "human_approval"
                  ? "text-amber-400"
                  : "text-emerald-400"
              }`}
            >
              {mode === "human_approval" ? "Ручной контроль" : "Авто"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-gray-500">Создан:</span>
            <span>{formatDate(created_at)}</span>
          </div>

          {current_gate && (
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Гейт:</span>
              <span className="text-amber-400 font-medium">
                {current_gate.replace("_", " ").toUpperCase()}
              </span>
            </div>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-gray-800 flex items-center justify-between">
          <span className="text-xs text-gray-500 font-mono">
            {project_id}
          </span>
          <span className="text-xs text-gray-500 group-hover:text-gray-300 transition-colors">
            Открыть →
          </span>
        </div>
      </div>
    </Link>
  );
}
