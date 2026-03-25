"use client";

import { useState } from "react";
import {
  PipelineBlock,
  AgentState,
  BlockStatus,
  computeAllBlockStatuses,
} from "@/lib/types";

interface BlockSidebarProps {
  blocks: PipelineBlock[];
  agents: Record<string, AgentState>;
  selectedBlockId: string | null;
  onSelectBlock: (id: string) => void;
  onAddBlock: () => void;
  onReorderBlocks: (blockIds: string[]) => void;
  onEditBlock?: (id: string) => void;
  onDeleteBlock?: (id: string) => void;
}

function StatusIcon({ status }: { status: BlockStatus }) {
  switch (status) {
    case "completed":
      return (
        <svg className="w-4 h-4 text-green-500 shrink-0" viewBox="0 0 16 16" fill="none">
          <path
            d="M13.25 4.75L6 12 2.75 8.75"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "running":
      return (
        <span className="relative flex h-3 w-3 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
        </span>
      );
    case "pending":
      return (
        <span className="inline-flex h-3 w-3 rounded-full border-2 border-gray-500 shrink-0" />
      );
    case "blocked":
      return (
        <svg className="w-4 h-4 text-gray-500 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M8 1a4 4 0 0 0-4 4v2H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-1V5a4 4 0 0 0-4-4zm2.5 6V5a2.5 2.5 0 1 0-5 0v2h5z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "awaiting_approval":
      return (
        <svg className="w-4 h-4 text-amber-500 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M8 1.5a.75.75 0 0 1 .67.42l1.82 3.69 4.07.59a.75.75 0 0 1 .42 1.28l-2.95 2.87.7 4.06a.75.75 0 0 1-1.09.79L8 12.85l-3.64 1.91a.75.75 0 0 1-1.09-.79l.7-4.06-2.95-2.87a.75.75 0 0 1 .42-1.28l4.07-.59L7.33 1.92A.75.75 0 0 1 8 1.5z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "failed":
      return (
        <svg className="w-4 h-4 text-red-500 shrink-0" viewBox="0 0 16 16" fill="none">
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}

function getCompletedCount(block: PipelineBlock, agents: Record<string, AgentState>): number {
  return block.agents.filter((id) => {
    const a = agents[id];
    return a && (a.status === "completed" || a.status === "skipped");
  }).length;
}

export default function BlockSidebar({
  blocks,
  agents,
  selectedBlockId,
  onSelectBlock,
  onAddBlock,
  onEditBlock,
  onDeleteBlock,
}: BlockSidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const blockStatuses = computeAllBlockStatuses(blocks, agents);

  return (
    <aside className="w-72 bg-gray-950 border-r border-gray-800 flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
          Блоки пайплайна
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {blocks.map((block, idx) => {
          const status = blockStatuses[block.id];
          const isBlocked = status === "blocked";
          const isSelected = selectedBlockId === block.id;
          const isHovered = hoveredId === block.id;
          const completed = getCompletedCount(block, agents);
          const total = block.agents.length;

          const depBlockNames =
            isBlocked && block.depends_on?.length
              ? block.depends_on
                  .map((depId) => blocks.find((b) => b.id === depId)?.name)
                  .filter(Boolean)
                  .join(", ")
              : null;

          return (
            <div
              key={block.id}
              className={`
                relative group px-3 py-2.5 mx-1 my-0.5 rounded-md cursor-pointer
                transition-colors duration-100
                ${isBlocked ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-900"}
                ${isSelected ? "bg-gray-800 border-l-2 border-blue-500" : "border-l-2 border-transparent"}
              `}
              onClick={() => !isBlocked && onSelectBlock(block.id)}
              onMouseEnter={() => setHoveredId(block.id)}
              onMouseLeave={() => setHoveredId(null)}
              title={
                isBlocked && depBlockNames
                  ? `Ожидает завершения: ${depBlockNames}`
                  : undefined
              }
            >
              <div className="flex items-center gap-2.5">
                <StatusIcon status={status} />
                <span className="text-sm font-medium text-gray-200 truncate flex-1">
                  {block.name}
                </span>

                {isHovered && !isBlocked && (
                  <div className="flex items-center gap-1 shrink-0">
                    {onEditBlock && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditBlock(block.id);
                        }}
                        className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
                        title="Редактировать"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
                          <path
                            d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    )}
                    {onDeleteBlock && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteBlock(block.id);
                        }}
                        className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-red-400 transition-colors"
                        title="Удалить"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
                          <path
                            d="M2.5 4.5h11M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M6.5 7v4.5M9.5 7v4.5M3.5 4.5l.5 8.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l.5-8.5"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {total > 0 && (
                <div className="flex items-center gap-2 mt-1.5 ml-6">
                  <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full transition-all duration-300"
                      style={{ width: `${(completed / total) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 tabular-nums shrink-0">
                    {completed}/{total}
                  </span>
                </div>
              )}
              {block.depends_on?.length > 0 && (
                <div className="text-[10px] text-gray-600 mt-0.5 ml-6 truncate">
                  после: {block.depends_on.map((depId) => {
                    const dep = blocks.find((b) => b.id === depId);
                    return dep?.name || depId;
                  }).join(", ")}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="p-3 border-t border-gray-800">
        <button
          onClick={onAddBlock}
          className="w-full py-2 rounded-lg border-2 border-dashed border-gray-700 text-gray-500
            hover:border-gray-600 hover:text-gray-400 transition-colors text-sm font-medium"
        >
          + Добавить блок
        </button>
      </div>
    </aside>
  );
}
