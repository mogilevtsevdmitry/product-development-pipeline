"use client";

import { useEffect, useState, useCallback, use } from "react";
import dynamic from "next/dynamic";
import StatusBadge from "@/components/StatusBadge";
import GatePanel from "@/components/GatePanel";
import type { ProjectState, GateType, ProjectStatus } from "@/lib/types";

const PipelineGraph = dynamic(() => import("@/components/PipelineGraph"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[600px] rounded-xl border border-gray-800 bg-gray-900 flex items-center justify-center">
      <span className="text-gray-500">Загрузка графа...</span>
    </div>
  ),
});

function formatDate(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function countByStatus(agents: Record<string, { status: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const agent of Object.values(agents)) {
    counts[agent.status] = (counts[agent.status] || 0) + 1;
  }
  return counts;
}

export default function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [state, setState] = useState<ProjectState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/state/${id}`);
      if (!res.ok) {
        setError("Проект не найден");
        return;
      }
      const data = await res.json();
      setState(data);
      setError(null);
    } catch {
      setError("Ошибка загрузки");
    }
  }, [id]);

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 3000);
    return () => clearInterval(interval);
  }, [fetchState]);

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-20">
          <h2 className="text-lg font-medium text-red-400">{error}</h2>
          <a href="/" className="text-blue-400 text-sm mt-2 inline-block hover:underline">
            ← Вернуться к проектам
          </a>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-800 rounded w-1/3" />
          <div className="h-[600px] bg-gray-900 rounded-xl border border-gray-800" />
        </div>
      </div>
    );
  }

  const statusCounts = countByStatus(state.agents);
  const totalAgents = Object.keys(state.agents).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <a
              href="/"
              className="text-gray-500 hover:text-gray-300 text-sm transition-colors"
            >
              Проекты
            </a>
            <span className="text-gray-600">/</span>
          </div>
          <h1 className="text-2xl font-bold text-white">{state.name}</h1>
          <p className="text-gray-500 text-sm font-mono mt-1">{state.project_id}</p>
        </div>
        <StatusBadge status={state.status as ProjectStatus} />
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
          <div className="text-xs text-gray-500 mb-1">Всего агентов</div>
          <div className="text-xl font-bold text-white">{totalAgents}</div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
          <div className="text-xs text-gray-500 mb-1">Завершено</div>
          <div className="text-xl font-bold text-emerald-400">
            {statusCounts.completed || 0}
          </div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
          <div className="text-xs text-gray-500 mb-1">В работе</div>
          <div className="text-xl font-bold text-blue-400">
            {statusCounts.running || 0}
          </div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
          <div className="text-xs text-gray-500 mb-1">Ожидают</div>
          <div className="text-xl font-bold text-gray-400">
            {statusCounts.pending || 0}
          </div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
          <div className="text-xs text-gray-500 mb-1">Ошибки</div>
          <div className="text-xl font-bold text-red-400">
            {statusCounts.failed || 0}
          </div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
          <div className="text-xs text-gray-500 mb-1">Режим</div>
          <div
            className={`text-sm font-medium ${
              state.mode === "human_approval"
                ? "text-amber-400"
                : "text-emerald-400"
            }`}
          >
            {state.mode === "human_approval" ? "Ручной" : "Авто"}
          </div>
        </div>
      </div>

      {/* Gate Panel */}
      {state.status === "paused_at_gate" && state.current_gate && (
        <div className="mb-6">
          <GatePanel
            projectId={state.project_id}
            gate={state.current_gate as GateType}
            onDecision={fetchState}
          />
        </div>
      )}

      {/* Pipeline Graph */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white mb-3">Граф пайплайна</h2>
        <PipelineGraph
          graph={state.pipeline_graph}
          agents={state.agents}
          projectId={state.project_id}
        />
      </div>

      {/* Info Sidebar as bottom section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Timestamps */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h3 className="font-semibold text-white mb-3">Информация</h3>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Создан</dt>
              <dd className="text-gray-300">{formatDate(state.created_at)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Обновлён</dt>
              <dd className="text-gray-300">{formatDate(state.updated_at)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Версия схемы</dt>
              <dd className="text-gray-300 font-mono">{state.schema_version}</dd>
            </div>
          </dl>
        </div>

        {/* Gate History */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h3 className="font-semibold text-white mb-3">История решений</h3>
          {Object.keys(state.gate_decisions).filter(k => state.gate_decisions[k] !== null).length === 0 ? (
            <p className="text-gray-500 text-sm">Решений пока нет</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(state.gate_decisions)
                .filter(([, gd]) => gd !== null)
                .map(([gateName, gd]) => (
                <div
                  key={gateName}
                  className="rounded-lg border border-gray-800 bg-gray-950 p-3"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-amber-400">
                      {gateName.replace(/_/g, " ").toUpperCase()}
                    </span>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        gd!.decision === "go"
                          ? "bg-emerald-400/10 text-emerald-400"
                          : gd!.decision === "stop" || gd!.decision === "no-go"
                          ? "bg-red-400/10 text-red-400"
                          : "bg-amber-400/10 text-amber-400"
                      }`}
                    >
                      {gd!.decision.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDate(gd!.timestamp)} · {gd!.decided_by}
                  </div>
                  {gd!.notes && (
                    <p className="text-xs text-gray-400 mt-1">{gd!.notes}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
