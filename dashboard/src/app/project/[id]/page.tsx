"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import { useRouter } from "next/navigation";
import BlockSidebar from "@/components/BlockSidebar";
import BlockView from "@/components/BlockView";
import ProjectChat from "@/components/ProjectChat";
import PreviewPanel from "@/components/PreviewPanel";
import DebateView from "@/components/DebateView";
import ProjectHeader from "@/components/project/ProjectHeader";
import type { ProjectState } from "@/lib/types";
import { computeAllBlockStatuses } from "@/lib/types";

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

      // Full auto: auto-approve any block awaiting approval before considering agents.
      if (data.full_auto) {
        const statuses = computeAllBlockStatuses(data.blocks || [], data.agents);
        const waiting = (data.blocks || []).find((b) => statuses[b.id] === "awaiting_approval");
        if (waiting) {
          await fetch(`/api/state/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "block_approval", blockId: waiting.id, decision: "go", notes: "auto-approved by full_auto" }),
          });
          return;
        }
      }

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

  // Aggregate tokens & cost (agents + pipeline generation)
  const projectStats = Object.values(state.agents).reduce(
    (acc, a) => {
      const u = a.total_usage ?? a.usage;
      if (u) {
        acc.tokens += u.input_tokens + u.output_tokens;
        acc.cost += u.cost_usd;
      }
      return acc;
    },
    { tokens: 0, cost: 0 }
  );
  projectStats.tokens += (state.generation_tokens_in ?? 0) + (state.generation_tokens_out ?? 0);
  projectStats.cost += state.generation_cost_usd ?? 0;

  const formatTokens = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);

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
      <ProjectHeader
        state={state}
        completed={completedAgents}
        total={totalAgents}
        tokens={projectStats.tokens}
        cost={projectStats.cost}
        actionLoading={actionLoading}
        onAction={sendAction}
      />

      {runningAgents.length > 0 && (
        <div style={{
          background: "var(--run-soft)", borderBottom: "1px solid var(--run-border)",
          padding: "6px 20px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
        }}>
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "var(--run)" }} />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: "var(--run)" }} />
          </span>
          <span style={{ color: "var(--run)", fontSize: 13 }}>
            Работает: {runningAgents.map(([id]) => id).join(", ")}
          </span>
          {runningAgents.length === 1 && (
            <a
              href={`/project/${id}/agent/${runningAgents[0][0]}`}
              style={{ marginLeft: "auto", fontSize: 12, color: "var(--run)", textDecoration: "none" }}
            >Открыть →</a>
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
          onAddBlock={(name, description, requiresApproval) => sendAction("add_block", { name, description, requires_approval: requiresApproval })}
          onReorderBlocks={(ids) => sendAction("reorder_blocks", { block_ids: ids })}
          onDeleteBlock={(blockId) => sendAction("remove_block", { block_id: blockId })}
        />

        <main className="flex-1 overflow-y-auto p-6">
          <PreviewPanel projectId={state.project_id} state={state} />

          {state.pipeline_type === "debate" ? (
            <DebateView projectId={state.project_id} state={state} />
          ) : state.blocks.length === 0 && state.description ? (
            state.generation_status === "failed" ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 max-w-lg mx-auto text-center">
                <div className="text-4xl">⚠️</div>
                <p className="text-sm text-red-400 font-medium">Не удалось сгенерировать пайплайн</p>
                {state.generation_error && (
                  <pre className="text-xs text-gray-500 whitespace-pre-wrap break-words bg-black/30 p-3 rounded-md border border-red-900/40 max-h-60 overflow-auto w-full text-left">
                    {state.generation_error}
                  </pre>
                )}
                <button
                  onClick={async () => {
                    await fetch(`/api/state/${state.project_id}/regenerate-blocks`, { method: "POST" });
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-md transition"
                >
                  Повторить
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
                <div className="animate-spin h-6 w-6 border-2 border-blue-400 border-t-transparent rounded-full" />
                <p className="text-sm">Генерация пайплайна из описания проекта...</p>
                <p className="text-xs text-gray-600">Claude анализирует описание и подбирает агентов</p>
              </div>
            )
          ) : selectedBlock && selectedBlockStatus ? (
            <BlockView
              block={selectedBlock}
              agents={state.agents}
              projectId={state.project_id}
              blockStatus={selectedBlockStatus}
              prevBlockName={depBlockNames}
              onApproval={handleBlockApproval}
              onAddAgent={(blockId, agentId) => sendAction("add_agent_to_block", { block_id: blockId, agent_id: agentId })}
              onRemoveAgent={(blockId, agentId) => sendAction("remove_agent_from_block", { block_id: blockId, agent_id: agentId })}
              onUpdateEdges={(blockId, edges) => sendAction("update_block_edges", { block_id: blockId, edges })}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              <p>Выберите блок в боковой панели</p>
            </div>
          )}
        </main>
      </div>

      {/* Project Chat */}
      <ProjectChat projectId={state.project_id} onAction={fetchState} />
    </div>
  );
}
