"use client";

import { useState } from "react";
import type { GateType } from "@/lib/types";

const GATE_INFO: Record<
  GateType,
  { title: string; description: string; decisions: { value: string; label: string; color: string }[] }
> = {
  gate_1: {
    title: "Гейт 1 — Валидация проблемы",
    description:
      "Проверка гипотезы проблемы: достаточно ли данных, подтверждена ли потребность рынка?",
    decisions: [
      { value: "go", label: "Go — Продолжить", color: "bg-emerald-600 hover:bg-emerald-500" },
      { value: "pivot", label: "Pivot — Пересмотреть", color: "bg-amber-600 hover:bg-amber-500" },
      { value: "stop", label: "Stop — Остановить", color: "bg-red-600 hover:bg-red-500" },
    ],
  },
  gate_2: {
    title: "Гейт 2 — Валидация решения",
    description:
      "Проверка решения: жизнеспособна ли стратегия продукта, подтверждён ли product-market fit?",
    decisions: [
      { value: "go", label: "Go — Продолжить", color: "bg-emerald-600 hover:bg-emerald-500" },
      { value: "narrow", label: "Narrow — Сузить", color: "bg-amber-600 hover:bg-amber-500" },
      { value: "stop", label: "Stop — Остановить", color: "bg-red-600 hover:bg-red-500" },
    ],
  },
  gate_3: {
    title: "Гейт 3 — Готовность к запуску",
    description:
      "Финальная проверка: готов ли продукт к MVP-запуску, все ли артефакты подготовлены?",
    decisions: [
      { value: "go", label: "Go — Запустить", color: "bg-emerald-600 hover:bg-emerald-500" },
      { value: "iterate", label: "Iterate — Доработать", color: "bg-amber-600 hover:bg-amber-500" },
      { value: "stop", label: "Stop — Остановить", color: "bg-red-600 hover:bg-red-500" },
    ],
  },
};

interface GatePanelProps {
  projectId: string;
  gate: GateType;
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

  const info = GATE_INFO[gate];
  if (!info) return null;

  const handleDecision = async (decision: string) => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/state/${projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gate, decision, notes: notes || undefined }),
      });
      if (res.ok) {
        setSubmitted(true);
        onDecision?.();
      }
    } catch (err) {
      console.error("Gate decision error:", err);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="rounded-xl border border-emerald-800 bg-emerald-950/30 p-6">
        <p className="text-emerald-400 font-medium">
          Решение принято. Пайплайн продолжает работу.
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
            onClick={() => handleDecision(d.value)}
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
