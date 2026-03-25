"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import { useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";
import BlockSidebar from "@/components/BlockSidebar";
import BlockView from "@/components/BlockView";
import type { ProjectState, ProjectStatus, BlockStatus, PipelineBlock } from "@/lib/types";
import { computeAllBlockStatuses } from "@/lib/types";

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
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const lastJsonRef = useRef<string>("");

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/state/${id}`);
      if (!res.ok) {
        setError("Проект не найден");
        return;
      }
      const text = await res.text();
      if (text !== lastJsonRef.current) {
        lastJsonRef.current = text;
        const parsed = JSON.parse(text) as ProjectState;
        setState(parsed);
        // Auto-select first block if none selected
        if (!selectedBlockId && parsed.blocks?.length) {
          setSelectedBlockId(parsed.blocks[0].id);
        }
      }
      setError(null);
    } catch {
      setError("Ошибка загрузки");
    }
  }, [id, selectedBlockId]);

  const sendAction = useCallback(
    async (action: string, extra?: Record<string, unknown>, method: "POST" | "DELETE" = "POST") => {
      setActionLoading(action);
      try {
        const res = await fetch(`/api/state/${id}`, {
          method,
          headers: { "Content-Type": "application/json" },
          ...(method === "POST" ? { body: JSON.stringify({ action, ...extra }) } : {}),
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

  // Auto-advance in auto mode
  const autoAdvance = useCallback(async () => {
    try {
      const res = await fetch(`/api/state/${id}`);
      if (!res.ok) return;
      const text = await res.text();
      if (text !== lastJsonRef.current) {
        lastJsonRef.current = text;
        setState(JSON.parse(text));
      }
      const data = JSON.parse(text) as ProjectState;

      if (data.status !== "running" || data.mode !== "auto") return;

      // Check if there are pending agents whose deps are all completed within their block
      const hasReady = data.blocks?.some((block) => {
        return block.agents.some((nodeId) => {
          const agent = data.agents[nodeId];
          if (!agent || agent.status !== "pending") return false;
          const deps = block.edges
            .filter(([, tgt]) => tgt === nodeId)
            .map(([src]) => src);
          return deps.every((d) => data.agents[d]?.status === "completed");
        });
      });

      if (hasReady) {
        await fetch(`/api/state/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "run_next" }),
        });
      }
    } catch {
      // Network error during polling — ignore silently
    }
  }, [id]);

  useEffect(() => {
    fetchState();
    const interval = setInterval(autoAdvance, 3000);
    return () => clearInterval(interval);
  }, [fetchState, autoAdvance]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
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
      <div className="flex items-center justify-center h-screen">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-800 rounded w-64" />
          <div className="h-4 bg-gray-800 rounded w-48" />
        </div>
      </div>
    );
  }

  const blocks = state.blocks || [];
  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) || null;

  // Compute block statuses
  const blockStatuses = computeAllBlockStatuses(blocks, state.agents);

  const selectedBlockStatus = selectedBlock ? blockStatuses[selectedBlock.id] : undefined;
  const depBlockNames = selectedBlock?.depends_on?.length
    ? selectedBlock.depends_on
        .map((depId) => blocks.find((b) => b.id === depId)?.name)
        .filter(Boolean)
        .join(", ")
    : undefined;

  // Running agents across all blocks
  const runningAgents = Object.entries(state.agents).filter(([, a]) => a.status === "running");

  // Overall stats
  const totalAgents = Object.keys(state.agents).length;
  const completedAgents = Object.values(state.agents).filter(
    (a) => a.status === "completed" || a.status === "skipped"
  ).length;

  const handleBlockApproval = async (blockId: string, decision: "go" | "stop", notes?: string) => {
    setActionLoading("block_approval");
    try {
      await fetch(`/api/state/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "block_approval", blockId, decision, notes }),
      });
      await fetchState();
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Top bar */}
      <header className="border-b border-gray-800 bg-gray-950 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="text-gray-500 hover:text-gray-300 text-sm transition-colors"
          >
            ← Проекты
          </a>
          <span className="text-gray-600">/</span>
          <h1 className="text-lg font-bold text-white">{state.name}</h1>
          <StatusBadge status={state.status as ProjectStatus} />
        </div>

        <div className="flex items-center gap-2">
          {/* Overall progress */}
          <span className="text-xs text-gray-500 mr-2">
            {completedAgents}/{totalAgents} агентов
            {state.current_cycle > 1 && (
              <span className="ml-1 text-indigo-400">· Цикл #{state.current_cycle}</span>
            )}
          </span>

          {/* Start pipeline */}
          {state.status === "created" && (
            <button
              onClick={() => sendAction("start_pipeline")}
              disabled={actionLoading !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors disabled:opacity-50"
            >
              {actionLoading === "start_pipeline" ? "⏳..." : "🚀 Запустить"}
            </button>
          )}

          {/* Run next */}
          {(state.status === "running" || state.status === "paused") && (
            <button
              onClick={() => sendAction("run_next")}
              disabled={actionLoading !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
            >
              {actionLoading === "run_next" ? "⏳..." : "▶ Следующий"}
            </button>
          )}

          {/* Restart cycle */}
          {(state.status === "completed" || state.status === "failed" || state.status === "running" || state.status === "paused") && (
            <button
              onClick={() => sendAction("restart_cycle")}
              disabled={actionLoading !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-indigo-600/40 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 transition-colors disabled:opacity-50"
            >
              {actionLoading === "restart_cycle" ? "⏳..." : "🔄 Новый цикл"}
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

          {/* Resume */}
          {(state.status === "paused" || state.status === "paused_at_gate" || state.status === "stopped" || state.status === "failed" || state.status === "completed") && (
            <button
              onClick={() => sendAction("resume")}
              disabled={actionLoading !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors disabled:opacity-50"
            >
              ▶ Возобновить
            </button>
          )}

          {/* Mode toggle */}
          <button
            disabled={actionLoading !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-50"
            onClick={() => {
              const newMode = state.mode === "auto" ? "human_approval" : "auto";
              sendAction("switch_mode", { mode: newMode });
            }}
          >
            {state.mode === "auto" ? "👤 Ручной" : "🤖 Авто"}
          </button>

          {/* Schedule toggle */}
          <button
            disabled={actionLoading !== null}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors disabled:opacity-50 ${
              state.schedule?.enabled
                ? "border-indigo-600/40 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20"
                : "border-gray-700 bg-gray-800 text-gray-500 hover:bg-gray-700"
            }`}
            onClick={() => {
              const current = state.schedule || { preset: "daily", enabled: false };
              sendAction("update_schedule", {
                schedule: { ...current, enabled: !current.enabled },
              });
            }}
          >
            {state.schedule?.enabled
              ? `⏰ ${state.schedule.preset === "daily" ? "Ежедневно" : state.schedule.preset === "weekly" ? "Еженедельно" : state.schedule.preset === "hourly" ? "Ежечасно" : state.schedule.cron || "По расписанию"}`
              : "📅 Расписание"}
          </button>

          {/* Delete */}
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              🗑
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => sendAction("delete", {}, "DELETE")}
                className="px-3 py-1.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors"
              >
                Удалить
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
      </header>

      {/* Running agent indicator - full width bar */}
      {runningAgents.length > 0 && (
        <div className="bg-blue-950/30 border-b border-blue-800/40 px-6 py-2 flex items-center gap-3 shrink-0">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
          </span>
          <span className="text-blue-400 text-sm">
            Работает: {runningAgents.map(([id]) => id).join(", ")}
          </span>
          {runningAgents.length === 1 && (
            <a
              href={`/project/${id}/agent/${runningAgents[0][0]}`}
              className="ml-auto text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              Открыть →
            </a>
          )}
        </div>
      )}

      {/* Main content: sidebar + block view */}
      <div className="flex flex-1 overflow-hidden">
        <BlockSidebar
          blocks={blocks}
          agents={state.agents}
          selectedBlockId={selectedBlockId}
          onSelectBlock={setSelectedBlockId}
          onAddBlock={() => sendAction("add_block", { name: "Новый блок" })}
          onReorderBlocks={(ids) => sendAction("reorder_blocks", { block_ids: ids })}
          onDeleteBlock={(blockId) => sendAction("remove_block", { block_id: blockId })}
        />

        <main className="flex-1 overflow-y-auto p-6">
          {selectedBlock && selectedBlockStatus ? (
            <BlockView
              block={selectedBlock}
              agents={state.agents}
              projectId={state.project_id}
              blockStatus={selectedBlockStatus}
              prevBlockName={depBlockNames}
              onApproval={handleBlockApproval}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              <p>Выберите блок в боковой панели</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
