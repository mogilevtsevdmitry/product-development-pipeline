"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import type {
  PipelineBlock,
  AgentState,
  BlockStatus,
  PipelineGraph as PipelineGraphType,
} from "@/lib/types";

const PipelineGraph = dynamic(() => import("@/components/PipelineGraph"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[400px] rounded-xl border border-gray-800 bg-gray-900 flex items-center justify-center">
      <span className="text-gray-500 text-sm">Loading graph...</span>
    </div>
  ),
});

interface BlockViewProps {
  block: PipelineBlock;
  agents: Record<string, AgentState>;
  projectId: string;
  blockStatus: BlockStatus;
  prevBlockName?: string;
  onApproval: (
    blockId: string,
    decision: "go" | "stop",
    notes?: string
  ) => void;
}

export default function BlockView({
  block,
  agents,
  projectId,
  blockStatus,
  prevBlockName,
  onApproval,
}: BlockViewProps) {
  const [notes, setNotes] = useState("");

  // Build a PipelineGraph-compatible object from block agents and edges
  const blockGraph: PipelineGraphType = useMemo(() => {
    // Compute parallel groups: agents with no internal edges between them
    const targets = new Set(block.edges.map(([, t]) => t));
    const sources = new Set(block.edges.map(([s]) => s));
    const roots = block.agents.filter((a) => !targets.has(a));
    const parallelGroups: string[][] = roots.length > 1 ? [roots] : [];

    return {
      nodes: block.agents,
      edges: block.edges,
      parallel_groups: parallelGroups,
    };
  }, [block.agents, block.edges]);

  // Compute block stats
  const stats = useMemo(() => {
    let completedCount = 0;
    let totalCost = 0;
    let totalTokens = 0;

    for (const agentId of block.agents) {
      const agent = agents[agentId];
      if (!agent) continue;

      if (agent.status === "completed" || agent.status === "skipped") {
        completedCount++;
      }

      const usage = agent.total_usage ?? agent.usage;
      if (usage) {
        totalCost += usage.cost_usd;
        totalTokens += usage.input_tokens + usage.output_tokens;
      }
    }

    return {
      completedCount,
      totalAgents: block.agents.length,
      totalCost,
      totalTokens,
    };
  }, [block.agents, agents]);

  // Failed agents list
  const failedAgents = useMemo(
    () =>
      block.agents.filter((id) => agents[id]?.status === "failed"),
    [block.agents, agents]
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Block header */}
      <div>
        <h2 className="text-xl font-bold text-white">{block.name}</h2>
        {block.description && (
          <p className="text-sm text-gray-400 mt-1">{block.description}</p>
        )}
      </div>

      {/* Status banners */}
      {blockStatus === "blocked" && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <svg
            className="w-5 h-5 text-amber-400 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
            />
          </svg>
          <span className="text-amber-200 text-sm">
            {prevBlockName
              ? `\u041E\u0436\u0438\u0434\u0430\u0435\u0442 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0438\u044F \u0431\u043B\u043E\u043A\u0430 \u00AB${prevBlockName}\u00BB`
              : "\u041E\u0436\u0438\u0434\u0430\u0435\u0442 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0438\u044F \u043F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0435\u0433\u043E \u0431\u043B\u043E\u043A\u0430"}
          </span>
        </div>
      )}

      {blockStatus === "failed" && failedAgents.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3">
          <svg
            className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          <div className="text-sm">
            <span className="text-red-300 font-medium">
              {failedAgents.length === 1
                ? "\u0410\u0433\u0435\u043D\u0442 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u043B\u0441\u044F \u0441 \u043E\u0448\u0438\u0431\u043A\u043E\u0439:"
                : "\u0410\u0433\u0435\u043D\u0442\u044B \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u043B\u0438\u0441\u044C \u0441 \u043E\u0448\u0438\u0431\u043A\u043E\u0439:"}
            </span>
            <span className="text-red-200 ml-1">
              {failedAgents.join(", ")}
            </span>
          </div>
        </div>
      )}

      {/* Gate panel (awaiting_approval) */}
      {blockStatus === "awaiting_approval" && (
        <div className="rounded-lg border border-blue-500/40 bg-blue-500/10 p-5">
          <h3 className="text-base font-semibold text-white mb-1">
            {"\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u0435: "}{block.name}
          </h3>
          <p className="text-sm text-gray-400 mb-4">
            {block.description ||
              "\u0411\u043B\u043E\u043A \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D. \u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0435\u043D\u0438\u0435."}
          </p>
          <textarea
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 resize-none mb-4"
            rows={3}
            placeholder={"\u0417\u0430\u043C\u0435\u0442\u043A\u0438 (\u043D\u0435\u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E)..."}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex items-center gap-3">
            <button
              onClick={() =>
                onApproval(block.id, "go", notes || undefined)
              }
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors cursor-pointer"
            >
              {"\u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C"} &rarr;
            </button>
            <button
              onClick={() =>
                onApproval(block.id, "stop", notes || undefined)
              }
              className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 transition-colors cursor-pointer"
            >
              {"\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C"}
            </button>
          </div>
        </div>
      )}

      {/* Mini ReactFlow graph */}
      <div className="h-[400px]">
        <PipelineGraph
          graph={blockGraph}
          agents={agents}
          projectId={projectId}
        />
      </div>

      {/* Block stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
            {"\u0410\u0433\u0435\u043D\u0442\u044B"}
          </p>
          <p className="text-lg font-semibold text-white">
            {stats.completedCount}
            <span className="text-gray-500 font-normal">
              {" / "}
              {stats.totalAgents}
            </span>
          </p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
            {"\u0421\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C"}
          </p>
          <p className="text-lg font-semibold text-white">
            ${stats.totalCost.toFixed(2)}
          </p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
            {"\u0422\u043E\u043A\u0435\u043D\u044B"}
          </p>
          <p className="text-lg font-semibold text-white">
            {stats.totalTokens >= 1_000_000
              ? `${(stats.totalTokens / 1_000_000).toFixed(1)}M`
              : stats.totalTokens >= 1_000
                ? `${(stats.totalTokens / 1_000).toFixed(1)}K`
                : stats.totalTokens.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}
