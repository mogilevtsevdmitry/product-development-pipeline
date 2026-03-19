"use client";

import { useState } from "react";
import type { GateType } from "@/lib/types";

const GATE_INFO: Record<
  GateType,
  {
    title: string;
    description: string;
    decisions: { value: string; label: string; color: string }[];
  }
> = {
  gate_1_build: {
    title: "🚦 Gate 1 — Строим?",
    description:
      "Проблема реальна, рынок существует, есть смысл инвестировать в разработку?",
    decisions: [
      { value: "go", label: "✅ Строим", color: "bg-emerald-600 hover:bg-emerald-500" },
      { value: "pivot", label: "🔄 Пивот", color: "bg-amber-600 hover:bg-amber-500" },
      { value: "stop", label: "⛔ Стоп", color: "bg-red-600 hover:bg-red-500" },
    ],
  },
  gate_2_architecture: {
    title: "🏗️ Gate 2 — Архитектура",
    description:
      "Техническое решение и дизайн утверждены? Архитектура соответствует требованиям, бюджету и срокам?",
    decisions: [
      { value: "go", label: "✅ Утвердить", color: "bg-emerald-600 hover:bg-emerald-500" },
      { value: "revise", label: "🔄 Доработать", color: "bg-amber-600 hover:bg-amber-500" },
      { value: "stop", label: "⛔ Стоп", color: "bg-red-600 hover:bg-red-500" },
    ],
  },
  gate_3_go_nogo: {
    title: "🚀 Gate 3 — Go / No-go",
    description:
      "Тесты пройдены, безопасность проверена, инфраструктура готова. Выкатываем в прод?",
    decisions: [
      { value: "go", label: "✅ Go — Релиз", color: "bg-emerald-600 hover:bg-emerald-500" },
      { value: "no-go", label: "⏸️ No-go", color: "bg-amber-600 hover:bg-amber-500" },
      { value: "rollback", label: "⛔ Rollback", color: "bg-red-600 hover:bg-red-500" },
    ],
  },
};

interface GatePanelProps {
  projectId: string;
  gate: string;
  onDecision?: () => void;
}

export default function GatePanel({
  projectId,
  gate,
  onDecision,
}: GatePanelProps) {
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const info = GATE_INFO[gate as GateType];

  // Для approval-точек в режиме human_approval
  if (!info) {
    const agentName = gate.replace("approval_", "");
    return (
      <div className="rounded-xl border border-blue-800/60 bg-blue-950/20 p-6 space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-blue-400">
            👤 Подтверждение: {agentName}
          </h3>
          <p className="text-sm text-gray-400 mt-1">
            Агент завершил работу. Подтвердите продолжение пайплайна.
          </p>
        </div>
        <button
          onClick={async () => {
            setSubmitting(true);
            try {
              const res = await fetch(`/api/state/${projectId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ gate, decision: "go" }),
              });
              if (res.ok) {
                setSubmitted(true);
                onDecision?.();
              }
            } finally {
              setSubmitting(false);
            }
          }}
          disabled={submitting || submitted}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {submitted ? "Продолжено ✓" : submitting ? "..." : "Продолжить →"}
        </button>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="rounded-xl border border-emerald-800 bg-emerald-950/30 p-6">
        <p className="text-emerald-400 font-medium">
          ✅ Решение принято. Пайплайн продолжает работу.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-800/60 bg-amber-950/20 p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-amber-400">{info.title}</h3>
        <p className="text-sm text-gray-400 mt-1">{info.description}</p>
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-2">
          Заметки (необязательно)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-white placeholder-gray-500 focus:border-amber-500 focus:outline-none resize-none"
          rows={3}
          placeholder="Комментарий к решению..."
          disabled={submitting}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        {info.decisions.map((d) => (
          <button
            key={d.value}
            onClick={async () => {
              setSubmitting(true);
              try {
                const res = await fetch(`/api/state/${projectId}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    gate,
                    decision: d.value,
                    notes: notes || undefined,
                  }),
                });
                if (res.ok) {
                  setSubmitted(true);
                  onDecision?.();
                }
              } finally {
                setSubmitting(false);
              }
            }}
            disabled={submitting}
            className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${d.color} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {d.label}
          </button>
        ))}
      </div>
    </div>
  );
}
