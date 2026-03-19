"use client";

import { useState } from "react";

interface FeedbackPanelProps {
  projectId: string;
  fromAgent: string;
  allowedTargets: string[];
}

const AGENT_LABELS: Record<string, string> = {
  "backend-developer": "Backend Developer",
  "frontend-developer": "Frontend Developer",
  "devops-engineer": "DevOps Engineer",
};

const SEVERITY_OPTIONS = [
  { value: "critical", label: "🔴 Critical", color: "text-red-400" },
  { value: "high", label: "🟠 High", color: "text-orange-400" },
  { value: "medium", label: "🟡 Medium", color: "text-yellow-400" },
  { value: "low", label: "🟢 Low", color: "text-green-400" },
];

export default function FeedbackPanel({ projectId, fromAgent, allowedTargets }: FeedbackPanelProps) {
  const [toAgent, setToAgent] = useState(allowedTargets[0] || "");
  const [severity, setSeverity] = useState("high");
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string[]>([]);

  const sendFeedback = async () => {
    if (!description.trim()) return;
    setSending(true);

    try {
      const res = await fetch(`/api/state/${projectId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_agent: fromAgent,
          to_agent: toAgent,
          severity,
          description: description.trim(),
        }),
      });

      if (res.ok) {
        setSent((prev) => [...prev, `→ ${AGENT_LABELS[toAgent]}: ${description.slice(0, 50)}...`]);
        setDescription("");
      }
    } finally {
      setSending(false);
    }
  };

  if (allowedTargets.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-800/50 bg-amber-900/10 p-6">
      <h3 className="font-semibold text-amber-400 mb-4">
        🔄 Вернуть задачу разработчику
      </h3>
      <p className="text-xs text-gray-400 mb-4">
        Обнаружили проблему? Отправьте feedback — агент-разработчик получит описание и исправит.
      </p>

      {/* Target agent */}
      <div className="mb-3">
        <label className="text-xs text-gray-500 block mb-1">Кому вернуть</label>
        <div className="flex gap-2">
          {allowedTargets.map((t) => (
            <button
              key={t}
              onClick={() => setToAgent(t)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                toAgent === t
                  ? "bg-amber-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              {AGENT_LABELS[t] || t}
            </button>
          ))}
        </div>
      </div>

      {/* Severity */}
      <div className="mb-3">
        <label className="text-xs text-gray-500 block mb-1">Severity</label>
        <div className="flex gap-2">
          {SEVERITY_OPTIONS.map((s) => (
            <button
              key={s.value}
              onClick={() => setSeverity(s.value)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                severity === s.value
                  ? "bg-gray-700 ring-1 ring-amber-500"
                  : "bg-gray-800 hover:bg-gray-700"
              } ${s.color}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Description */}
      <div className="mb-3">
        <label className="text-xs text-gray-500 block mb-1">Описание проблемы</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Опишите проблему: шаги воспроизведения, ожидаемое поведение, фактическое..."
          rows={4}
          className="w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-3 text-sm text-gray-200 placeholder-gray-500 focus:border-amber-500 focus:outline-none resize-y"
        />
      </div>

      {/* Send */}
      <button
        onClick={sendFeedback}
        disabled={sending || !description.trim()}
        className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {sending ? "Отправка..." : `Вернуть задачу → ${AGENT_LABELS[toAgent] || toAgent}`}
      </button>

      {/* Sent history */}
      {sent.length > 0 && (
        <div className="mt-4 space-y-1">
          <div className="text-xs text-gray-500">Отправлено:</div>
          {sent.map((s, i) => (
            <div key={i} className="text-xs text-amber-400/70">✓ {s}</div>
          ))}
        </div>
      )}
    </div>
  );
}
