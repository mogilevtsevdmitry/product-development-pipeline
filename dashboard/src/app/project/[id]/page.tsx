"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [state, setState] = useState<ProjectState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const lastJsonRef = useRef<string>("");

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/state/${id}`);
      if (!res.ok) {
        setError("Проект не найден");
        return;
      }
      const text = await res.text();
      // Only update state if data actually changed — prevents re-renders and scroll jumps
      if (text !== lastJsonRef.current) {
        lastJsonRef.current = text;
        setState(JSON.parse(text));
      }
      setError(null);
    } catch {
      setError("Ошибка загрузки");
    }
  }, [id]);

  const sendAction = useCallback(
    async (action: string, method: "POST" | "DELETE" = "POST") => {
      setActionLoading(action);
      try {
        const res = await fetch(`/api/state/${id}`, {
          method,
          headers: { "Content-Type": "application/json" },
          ...(method === "POST" ? { body: JSON.stringify({ action }) } : {}),
        });
        if (res.ok) {
          if (action === "delete") {
            router.push("/");
            return;
          }
          await fetchState();
        }
      } finally {
        setActionLoading(null);
      }
    },
    [id, fetchState, router]
  );

  // Auto-advance: when agent completes in auto mode, launch next
  const autoAdvance = useCallback(async () => {
    const res = await fetch(`/api/state/${id}`);
    if (!res.ok) return;
    const text = await res.text();
    if (text !== lastJsonRef.current) {
      lastJsonRef.current = text;
      setState(JSON.parse(text));
    }
    const data = JSON.parse(text);

    if (data.status !== "running" || data.mode !== "auto") return;

    // Check if there are pending agents whose deps are all completed
    const hasReady = (data.pipeline_graph.nodes as string[]).some((nodeId: string) => {
      const agent = data.agents[nodeId];
      if (!agent || agent.status !== "pending") return false;
      const deps = (data.pipeline_graph.edges as [string, string][])
        .filter(([, tgt]: [string, string]) => tgt === nodeId)
        .map(([src]: [string, string]) => src);
      return deps.every((d: string) => data.agents[d]?.status === "completed");
    });

    if (hasReady) {
      await fetch(`/api/state/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_next" }),
      });
    }
  }, [id]);

  useEffect(() => {
    fetchState();
    const interval = setInterval(autoAdvance, 3000);
    return () => clearInterval(interval);
  }, [fetchState, autoAdvance]);

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
        <div className="flex items-center gap-3">
          <StatusBadge status={state.status as ProjectStatus} />
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-6 p-4 rounded-xl border border-gray-800 bg-gray-900">
        {/* Start pipeline */}
        {state.status === "created" && (
          <button
            onClick={() => sendAction("start_pipeline")}
            disabled={actionLoading !== null}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors disabled:opacity-50"
          >
            {actionLoading === "start_pipeline" ? (
              <><span className="animate-spin">⏳</span> Запускается...</>
            ) : (
              <>🚀 Запустить пайплайн</>
            )}
          </button>
        )}

        {/* Run next agent */}
        {(state.status === "running" || state.status === "paused") && (
          <button
            onClick={() => sendAction("run_next")}
            disabled={actionLoading !== null}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
          >
            {actionLoading === "run_next" ? (
              <><span className="animate-spin">⏳</span> Агент работает...</>
            ) : (
              <>▶ Запустить следующего агента</>
            )}
          </button>
        )}

        {/* Auto-run all */}
        {state.status === "running" && state.mode === "auto" && (
          <button
            onClick={() => sendAction("start_pipeline")}
            disabled={actionLoading !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-emerald-600/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
          >
            {actionLoading === "start_pipeline" ? "⏳ Работает..." : "⚡ Запустить всех готовых"}
          </button>
        )}

        {/* Pause */}
        {state.status === "running" && (
          <button
            onClick={() => sendAction("pause")}
            disabled={actionLoading !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-yellow-600/40 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
          >
            ⏸ Пауза
          </button>
        )}

        {/* Resume — for paused, stopped, failed, completed */}
        {(state.status === "paused" || state.status === "paused_at_gate" || state.status === "stopped" || state.status === "failed" || state.status === "completed") && (
          <button
            onClick={() => sendAction("resume")}
            disabled={actionLoading !== null}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors disabled:opacity-50"
          >
            {state.status === "stopped" || state.status === "failed"
              ? "🔄 Вернуть в работу"
              : state.status === "completed"
              ? "🔄 Продолжить пайплайн"
              : "▶ Возобновить"}
          </button>
        )}

        {/* Stop */}
        {(state.status === "running" || state.status === "paused" || state.status === "paused_at_gate" || state.status === "created") && (
          <button
            onClick={() => sendAction("stop")}
            disabled={actionLoading !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-red-600/40 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
          >
            ⏹ Остановить
          </button>
        )}

        {/* Mode toggle */}
        <button
          disabled={actionLoading !== null || state.status === "stopped" || state.status === "completed"}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-50"
          onClick={async () => {
            setActionLoading("switch_mode");
            try {
              const newMode = state.mode === "auto" ? "human_approval" : "auto";
              await fetch(`/api/state/${id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "switch_mode", mode: newMode }),
              });
              await fetchState();
            } finally {
              setActionLoading(null);
            }
          }}
        >
          {state.mode === "auto" ? "👤 Ручной режим" : "🤖 Авто режим"}
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Delete */}
        {!showDeleteConfirm ? (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            disabled={actionLoading !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
          >
            🗑 Удалить
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-red-400">Удалить проект?</span>
            <button
              onClick={() => sendAction("delete", "DELETE")}
              disabled={actionLoading !== null}
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50"
            >
              Да, удалить
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-700 text-gray-400 hover:text-gray-300 transition-colors"
            >
              Отмена
            </button>
          </div>
        )}
      </div>

      {/* Completed but has unresolved gates — show reactivate button */}
      {state.status === "completed" && Object.keys(state.gate_decisions).length === 0 && (
        <div className="mb-6 rounded-xl border border-amber-800/40 bg-amber-950/20 p-5">
          <h3 className="text-base font-semibold text-amber-400 mb-2">
            🚦 Есть непройденные контрольные точки
          </h3>
          <p className="text-sm text-gray-400 mb-3">
            Статическая цепочка агентов завершена. Для продолжения нужно пройти Gate-точку
            и подтвердить разработку.
          </p>
          <button
            onClick={() => sendAction("reactivate_gate")}
            disabled={actionLoading !== null}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {actionLoading === "reactivate_gate" ? "⏳..." : "🚦 Перейти к Gate-решению"}
          </button>
        </div>
      )}

      {/* Created banner */}
      {state.status === "created" && (
        <div className="mb-6 rounded-xl border border-indigo-800/40 bg-indigo-950/20 p-5">
          <h3 className="text-base font-semibold text-indigo-400 mb-2">
            📋 Проект создан
          </h3>
          <p className="text-sm text-gray-400 mb-3">
            Пайплайн готов к запуску. Нажмите <strong className="text-indigo-300">«Запустить пайплайн»</strong> чтобы
            начать выполнение с первого агента ({state.pipeline_graph.nodes[0]}).
          </p>
          <p className="text-xs text-gray-500">
            Режим: {state.mode === "auto"
              ? "🤖 Авто — агенты запускаются по цепочке до gate-точки"
              : "👤 Ручной — пауза после каждого агента для вашего ревью"}
          </p>
        </div>
      )}

      {/* Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
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
        {/* Cost stats */}
        {(() => {
          const agents = Object.values(state.agents);
          const totalCost = agents.reduce((s, a) => s + (a.usage?.cost_usd || 0), 0);
          const totalTokensIn = agents.reduce((s, a) => s + (a.usage?.input_tokens || 0) + (a.usage?.cache_creation_tokens || 0) + (a.usage?.cache_read_tokens || 0), 0);
          const totalTokensOut = agents.reduce((s, a) => s + (a.usage?.output_tokens || 0), 0);
          return (
            <>
              <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                <div className="text-xs text-gray-500 mb-1">💰 Стоимость</div>
                <div className="text-xl font-bold text-amber-400">
                  ${totalCost.toFixed(2)}
                </div>
              </div>
              <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                <div className="text-xs text-gray-500 mb-1">📊 Токены</div>
                <div className="text-sm font-medium text-gray-300">
                  <span className="text-blue-400">↓{(totalTokensIn/1000).toFixed(0)}K</span>
                  {" / "}
                  <span className="text-emerald-400">↑{(totalTokensOut/1000).toFixed(0)}K</span>
                </div>
              </div>
            </>
          );
        })()}
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

      {/* Running agent indicator */}
      {Object.entries(state.agents)
        .filter(([, a]) => a.status === "running")
        .map(([agentId]) => (
          <div
            key={agentId}
            className="mb-6 rounded-xl border border-blue-800/40 bg-blue-950/20 p-4 flex items-center gap-3"
          >
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
            </span>
            <div>
              <span className="text-blue-400 font-medium text-sm">
                Агент работает: {agentId}
              </span>
              <span className="text-gray-500 text-xs ml-2">
                Это может занять несколько минут...
              </span>
            </div>
            <a
              href={`/project/${id}/agent/${agentId}`}
              className="ml-auto text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              Открыть →
            </a>
          </div>
        ))}

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
