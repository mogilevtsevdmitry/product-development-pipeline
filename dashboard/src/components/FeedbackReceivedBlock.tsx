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
}: {
  feedback: FeedbackItem[];
  agentLabels: Record<string, string>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const allResolved = feedback.every((f) => f.resolved);
  const unresolvedCount = feedback.filter((f) => !f.resolved).length;

  return (
    <div
      className={`rounded-xl border p-6 ${
        allResolved
          ? "border-green-800/50 bg-green-900/10"
          : "border-red-800/50 bg-red-900/10"
      }`}
    >
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between"
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
          className={`w-5 h-5 transition-transform ${
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
