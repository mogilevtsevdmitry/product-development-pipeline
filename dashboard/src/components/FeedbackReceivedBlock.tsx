"use client";

import { useState } from "react";
import type { FeedbackItem } from "@/lib/types";

const SEV_COLORS: Record<string, string> = {
  critical: "border-red-600 bg-red-900/20",
  high: "border-orange-600 bg-orange-900/20",
  medium: "border-yellow-600 bg-yellow-900/20",
  low: "border-green-600 bg-green-900/20",
};

const SEV_LABELS: Record<string, string> = {
  critical: "🔴 CRITICAL",
  high: "🟠 HIGH",
  medium: "🟡 MEDIUM",
  low: "🟢 LOW",
};

/** Max chars before truncation with "show more" */
const TRUNCATE_AT = 300;

function FeedbackItemCard({
  fb,
  agentLabels,
}: {
  fb: FeedbackItem;
  agentLabels: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = fb.description.length > TRUNCATE_AT;
  const displayText = isLong && !expanded
    ? fb.description.slice(0, TRUNCATE_AT) + "…"
    : fb.description;

  return (
    <div
      className={`rounded-lg border p-4 ${SEV_COLORS[fb.severity] || "border-gray-700"} ${fb.resolved ? "opacity-50" : ""}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">
          {SEV_LABELS[fb.severity]} — от {agentLabels[fb.from_agent] || fb.from_agent}
        </span>
        <div className="flex items-center gap-2">
          {fb.resolved && (
            <span className="text-xs text-green-400 bg-green-900/30 px-2 py-1 rounded">
              ✓ Исправлено
            </span>
          )}
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              {expanded ? "Свернуть" : "Развернуть"}
            </button>
          )}
        </div>
      </div>

      <p
        className={`text-sm text-gray-300 whitespace-pre-wrap ${
          fb.resolved ? "line-through opacity-70" : ""
        }`}
      >
        {displayText}
      </p>

      <div className="text-xs text-gray-500 mt-2">
        {new Date(fb.created_at).toLocaleString("ru-RU")}
        {fb.resolved && fb.resolved_at && (
          <span className="ml-2 text-green-500">
            — исправлено {new Date(fb.resolved_at).toLocaleString("ru-RU")}
          </span>
        )}
      </div>
    </div>
  );
}

export default function FeedbackReceivedBlock({
  feedback,
  agentLabels,
  agentStatus,
  projectId,
  agentId,
  onAgentStarted,
}: {
  feedback: FeedbackItem[];
  agentLabels: Record<string, string>;
  agentStatus?: string;
  projectId?: string;
  agentId?: string;
  onAgentStarted?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [starting, setStarting] = useState(false);
  const allResolved = feedback.every((f) => f.resolved);
  const unresolvedCount = feedback.filter((f) => !f.resolved).length;

  async function handleStartFixing() {
    if (!projectId || !agentId) return;
    setStarting(true);
    try {
      const res = await fetch(`/api/state/${projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_agent", agentId }),
      });
      if (res.ok) {
        onAgentStarted?.();
      } else {
        const data = await res.json();
        alert(data.error || "Ошибка запуска агента");
      }
    } catch {
      alert("Ошибка сети");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div
      className={`rounded-xl border p-6 ${
        allResolved
          ? "border-green-800/50 bg-green-900/10"
          : "border-red-800/50 bg-red-900/10"
      }`}
    >
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 flex-1"
        >
          <h3
            className={`font-semibold ${
              allResolved ? "text-green-400" : "text-red-400"
            }`}
          >
            {allResolved
              ? `✅ Все замечания исправлены (${feedback.length})`
              : `⚠️ Полученные замечания (${unresolvedCount} нерешённых из ${feedback.length})`}
          </h3>
          <svg
            className={`w-5 h-5 transition-transform flex-shrink-0 ${
              allResolved ? "text-green-400" : "text-red-400"
            } ${collapsed ? "" : "rotate-180"}`}
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
        </button>

        {/* Start fixing button — only for pending agents with unresolved feedback */}
        {agentStatus === "pending" && !allResolved && projectId && agentId && (
          <button
            onClick={handleStartFixing}
            disabled={starting}
            className="ml-4 px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            {starting ? "Запуск..." : "🔧 Запустить исправления"}
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="space-y-3 mt-4">
          {feedback.map((fb, i) => (
            <FeedbackItemCard key={i} fb={fb} agentLabels={agentLabels} />
          ))}
        </div>
      )}
    </div>
  );
}
