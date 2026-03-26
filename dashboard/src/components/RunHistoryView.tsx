"use client";

import { useState } from "react";
import type { AgentRunRecord } from "@/lib/types";
import ArtifactViewer from "./ArtifactViewer";

export default function RunHistoryView({
  projectId,
  agentId,
  runHistory,
  phase,
}: {
  projectId: string;
  agentId: string;
  runHistory: AgentRunRecord[];
  phase: string;
}) {
  const [selectedRun, setSelectedRun] = useState<number | null>(null);
  const [viewingArtifact, setViewingArtifact] = useState<string | null>(null);

  // Fix run numbers: assign sequential numbers if they're all the same
  const fixed = runHistory.map((run, idx) => ({
    ...run,
    run_number: run.run_number || idx + 1,
    _index: idx,
  }));
  // Deduplicate run_numbers by reassigning if duplicates exist
  const seenNumbers = new Set<number>();
  for (const run of fixed) {
    if (seenNumbers.has(run.run_number)) {
      run.run_number = fixed.indexOf(run) + 1;
    }
    seenNumbers.add(run.run_number);
  }
  const sorted = [...fixed].sort((a, b) => b.run_number - a.run_number);

  function formatDuration(ms?: number): string {
    if (!ms) return "—";
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}с`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}м ${seconds}с`;
  }

  function formatDate(iso?: string): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  const activeRun = sorted.find((r) => r.run_number === selectedRun);

  return (
    <div className="space-y-4">
      {/* Timeline */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h3 className="font-semibold text-white mb-4">
          История запусков ({runHistory.length})
        </h3>

        <div className="space-y-2">
          {sorted.map((run) => {
            const isSelected = selectedRun === run.run_number;
            const statusColor =
              run.status === "completed"
                ? "border-green-600 bg-green-900/20"
                : run.status === "failed"
                ? "border-red-600 bg-red-900/20"
                : "border-blue-600 bg-blue-900/20";
            const statusIcon =
              run.status === "completed"
                ? "✅"
                : run.status === "failed"
                ? "❌"
                : "🔄";

            return (
              <button
                key={`run-${run._index}-${run.run_number}`}
                onClick={() =>
                  setSelectedRun(isSelected ? null : run.run_number)
                }
                className={`w-full text-left rounded-lg border p-4 transition-all ${statusColor} ${
                  isSelected
                    ? "ring-2 ring-amber-500/50"
                    : "hover:brightness-110"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{statusIcon}</span>
                    <div>
                      <span className="text-sm font-medium text-white">
                        Запуск #{run.run_number}
                      </span>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {formatDate(run.started_at)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-gray-400">
                    {run.usage && (
                      <>
                        <span title="Стоимость">
                          💰 ${run.usage.cost_usd.toFixed(4)}
                        </span>
                        <span title="Токены">
                          🔤{" "}
                          {(
                            run.usage.input_tokens + run.usage.output_tokens
                          ).toLocaleString()}
                        </span>
                        <span title="Модель">
                          🤖 {run.usage.model || "—"}
                        </span>
                      </>
                    )}
                    <span title="Длительность">
                      ⏱️ {formatDuration(run.usage?.duration_ms)}
                    </span>
                    <span title="Артефакты">
                      📄 {run.artifacts.length}
                    </span>

                    <svg
                      className={`w-4 h-4 transition-transform ${
                        isSelected ? "rotate-180" : ""
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </div>
                </div>

                {run.error && (
                  <div className="mt-2 text-xs text-red-400 truncate">
                    {run.error}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Expanded run details */}
      {activeRun && (
        <div className="rounded-xl border border-amber-800/50 bg-gray-900 p-6 space-y-4">
          <h3 className="font-semibold text-amber-400">
            Запуск #{activeRun.run_number} — Подробности
          </h3>

          {/* Info grid */}
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <dt className="text-gray-500">Запущен</dt>
              <dd className="text-white">{formatDate(activeRun.started_at)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Завершён</dt>
              <dd className="text-white">
                {formatDate(activeRun.completed_at)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Длительность</dt>
              <dd className="text-white">
                {formatDuration(activeRun.usage?.duration_ms)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Статус</dt>
              <dd
                className={
                  activeRun.status === "completed"
                    ? "text-green-400"
                    : activeRun.status === "failed"
                    ? "text-red-400"
                    : "text-blue-400"
                }
              >
                {activeRun.status === "completed"
                  ? "Завершён"
                  : activeRun.status === "failed"
                  ? "Ошибка"
                  : "В работе"}
              </dd>
            </div>
          </dl>

          {/* Usage */}
          {activeRun.usage && (
            <div className="rounded-lg border border-gray-700 p-4">
              <h4 className="text-sm font-medium text-gray-400 mb-2">
                Использование токенов
              </h4>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-xs">
                <div>
                  <span className="text-gray-500">Модель</span>
                  <div className="text-white font-mono">
                    {activeRun.usage.model || "—"}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500">Input</span>
                  <div className="text-white">
                    {activeRun.usage.input_tokens.toLocaleString()}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500">Output</span>
                  <div className="text-white">
                    {activeRun.usage.output_tokens.toLocaleString()}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500">Cache Create</span>
                  <div className="text-white">
                    {activeRun.usage.cache_creation_tokens.toLocaleString()}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500">Cache Read</span>
                  <div className="text-white">
                    {activeRun.usage.cache_read_tokens.toLocaleString()}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500">Стоимость</span>
                  <div className="text-amber-400 font-medium">
                    ${activeRun.usage.cost_usd.toFixed(4)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Artifacts */}
          {activeRun.artifacts.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-400 mb-2">
                Артефакты ({activeRun.artifacts.length})
              </h4>
              <div className="flex flex-wrap gap-2">
                {activeRun.artifacts.map((art) => (
                  <button
                    key={art}
                    onClick={() =>
                      setViewingArtifact(
                        viewingArtifact === art ? null : art
                      )
                    }
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      viewingArtifact === art
                        ? "border-amber-500 bg-amber-900/20 text-amber-300"
                        : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600"
                    }`}
                  >
                    📄 {art.split("/").pop()}
                  </button>
                ))}
              </div>

              {viewingArtifact && (
                <div className="mt-3">
                  <ArtifactViewer
                    projectId={projectId}
                    artifactPath={viewingArtifact}
                    runDir={`${phase}/${agentId}/${activeRun.run_dir}`}
                  />
                </div>
              )}
            </div>
          )}

          {activeRun.error && (
            <div className="rounded-lg border border-red-800 bg-red-900/10 p-4">
              <h4 className="text-sm font-medium text-red-400 mb-1">Ошибка</h4>
              <pre className="text-xs text-red-300 whitespace-pre-wrap">
                {activeRun.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
