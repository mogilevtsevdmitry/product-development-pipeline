"use client";

import { useState, useCallback } from "react";
import type { ProjectState, DebateRound, DebateAgentRole, DebateRoles } from "@/lib/types";

const AGENT_LABELS: Record<string, string> = {
  "problem-researcher": "Problem Researcher",
  "market-researcher": "Market Researcher",
  "product-owner": "Product Owner",
  "pipeline-architect": "Pipeline Architect",
  "business-analyst": "Business Analyst",
  "legal-compliance": "Legal / Compliance",
  "ux-ui-designer": "UX/UI Designer",
  "system-architect": "System Architect",
  "tech-lead": "Tech Lead",
  "backend-developer": "Backend Developer",
  "frontend-developer": "Frontend Developer",
  "devops-engineer": "DevOps Engineer",
  "qa-engineer": "QA Engineer",
  "security-engineer": "Security Engineer",
  "release-manager": "Release Manager",
  "product-marketer": "Product Marketer",
  "smm-manager": "SMM Manager",
  "content-creator": "Content Creator",
  "customer-support": "Customer Support",
  "data-analyst": "Data Analyst",
};

const ROLE_CONFIG: Record<DebateAgentRole, { label: string; emoji: string; color: string }> = {
  analyst: { label: "Аналитик", emoji: "🔭", color: "blue" },
  producer: { label: "Производитель", emoji: "⚒️", color: "green" },
  controller: { label: "Контролёр", emoji: "🔍", color: "amber" },
};

const VERDICT_CONFIG = {
  "sign-off": { label: "Sign-off", emoji: "✅", color: "green" },
  issues: { label: "Есть замечания", emoji: "⚠️", color: "amber" },
  blocker: { label: "Блокер", emoji: "🚫", color: "red" },
};

interface Props {
  projectId: string;
  state: ProjectState;
}

export default function DebateView({ projectId, state }: Props) {
  const [loading, setLoading] = useState(false);
  const [expandedRound, setExpandedRound] = useState<number | null>(null);

  const debate = state.debate;
  if (!debate) return null;

  const handleAction = useCallback(
    async (action: "run_round" | "reset") => {
      setLoading(true);
      try {
        await fetch(`/api/state/${encodeURIComponent(projectId)}/debate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
      } finally {
        setTimeout(() => setLoading(false), 2000);
      }
    },
    [projectId]
  );

  const isRunning = debate.status === "running";
  const isCompleted = debate.status === "completed";
  const isIdle = debate.status === "idle";
  const currentAgent = debate.current_agent;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              ⚡ Штаб агентов
              {isCompleted && <span className="text-sm font-normal text-green-400">— Завершено</span>}
              {debate.status === "deadlocked" && <span className="text-sm font-normal text-red-400">— Тупик</span>}
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              Раунд {debate.current_round} из {debate.max_rounds}
            </p>
          </div>
          <div className="flex gap-2">
            {(isIdle || (!isRunning && !isCompleted)) && debate.current_round < debate.max_rounds && (
              <button
                onClick={() => handleAction("run_round")}
                disabled={loading}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
              >
                {loading ? "Запуск..." : debate.current_round === 0 ? "▶ Запустить первый раунд" : "▶ Следующий раунд"}
              </button>
            )}
            {(isCompleted || debate.status === "deadlocked") && (
              <button
                onClick={() => handleAction("reset")}
                disabled={loading}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
              >
                🔄 Сброс
              </button>
            )}
          </div>
        </div>

        {/* Task */}
        <div className="rounded-lg bg-gray-950 border border-gray-800 p-4">
          <p className="text-xs text-gray-500 mb-1">Задача</p>
          <p className="text-sm text-gray-300 whitespace-pre-wrap">{debate.task}</p>
        </div>

        {/* Roles → Agents mapping */}
        {debate.roles && (
          <div className="mt-4 grid grid-cols-3 gap-3">
            {(["analyst", "producer", "controller"] as DebateAgentRole[]).map((role) => {
              const config = ROLE_CONFIG[role];
              const agentId = debate.roles[role];
              const agentName = AGENT_LABELS[agentId] || agentId;
              return (
                <div key={role} className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                  <p className="text-xs text-gray-500">{config.emoji} {config.label}</p>
                  <p className="text-sm font-medium text-gray-300 mt-0.5">{agentName}</p>
                  <p className="text-xs text-gray-600 font-mono">{agentId}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* Agent pipeline indicator */}
        {isRunning && currentAgent && (
          <div className="mt-4 flex items-center gap-2">
            {(["analyst", "producer", "controller"] as DebateAgentRole[]).map((role, i) => {
              const config = ROLE_CONFIG[role];
              const isActive = currentAgent === role;
              const isDone = (() => {
                const currentRound = debate.rounds[debate.rounds.length - 1];
                if (!currentRound) return false;
                if (role === "analyst") return !!currentRound.analyst;
                if (role === "producer") return !!currentRound.producer;
                return !!currentRound.controller;
              })();
              return (
                <div key={role} className="flex items-center gap-2">
                  {i > 0 && <span className="text-gray-600">→</span>}
                  <div
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 ${
                      isActive
                        ? `bg-${config.color}-500/20 text-${config.color}-400 border border-${config.color}-700/40 animate-pulse`
                        : isDone
                          ? "bg-gray-800 text-gray-400 border border-gray-700"
                          : "bg-gray-950 text-gray-600 border border-gray-800"
                    }`}
                  >
                    {isActive && <div className="animate-spin h-3 w-3 border border-current border-t-transparent rounded-full" />}
                    {isDone && <span>✓</span>}
                    {config.emoji} {config.label}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Rounds */}
      {debate.rounds.map((round) => (
        <RoundCard
          key={round.round}
          round={round}
          isExpanded={expandedRound === round.round || round.round === debate.current_round}
          onToggle={() => setExpandedRound(expandedRound === round.round ? null : round.round)}
          isCurrentRound={round.round === debate.current_round}
          isRunning={isRunning}
        />
      ))}

      {/* Final result */}
      {isCompleted && debate.rounds.length > 0 && (
        <div className="rounded-xl border border-green-800/50 bg-green-950/20 p-6">
          <h3 className="font-semibold text-green-300 mb-3">📋 Финальный результат</h3>
          <div className="text-sm text-gray-300 whitespace-pre-wrap font-mono bg-gray-950 rounded-lg p-4 border border-gray-800 max-h-96 overflow-y-auto">
            {debate.rounds[debate.rounds.length - 1]?.producer?.output || "Нет результата"}
          </div>
        </div>
      )}
    </div>
  );
}

function RoundCard({
  round,
  isExpanded,
  onToggle,
  isCurrentRound,
  isRunning,
}: {
  round: DebateRound;
  isExpanded: boolean;
  onToggle: () => void;
  isCurrentRound: boolean;
  isRunning: boolean;
}) {
  const verdict = round.controller?.verdict;
  const verdictConfig = verdict ? VERDICT_CONFIG[verdict] : null;

  return (
    <div className={`rounded-xl border ${isCurrentRound && isRunning ? "border-blue-700/50 bg-blue-950/10" : "border-gray-800 bg-gray-900"} overflow-hidden`}>
      {/* Round header */}
      <button
        onClick={onToggle}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-gray-300">Раунд {round.round}</span>
          {verdictConfig && (
            <span className={`text-xs px-2 py-0.5 rounded-full bg-${verdictConfig.color}-500/20 text-${verdictConfig.color}-400 border border-${verdictConfig.color}-700/40`}>
              {verdictConfig.emoji} {verdictConfig.label}
            </span>
          )}
          {isCurrentRound && isRunning && !verdict && (
            <span className="text-xs text-blue-400 animate-pulse">В процессе...</span>
          )}
        </div>
        <span className="text-xs text-gray-500">{isExpanded ? "▼" : "▶"}</span>
      </button>

      {/* Round content */}
      {isExpanded && (
        <div className="px-6 pb-5 space-y-4">
          {/* Analyst */}
          {round.analyst && (
            <AgentBlock
              role="analyst"
              output={round.analyst.output}
              extra={round.analyst.focus ? `Фокус: ${round.analyst.focus}` : undefined}
            />
          )}

          {/* Producer */}
          {round.producer && (
            <AgentBlock role="producer" output={round.producer.output} />
          )}

          {/* Controller */}
          {round.controller && (
            <AgentBlock
              role="controller"
              output={round.controller.output}
              extra={round.controller.issues?.join("\n")}
            />
          )}
        </div>
      )}
    </div>
  );
}

function AgentBlock({
  role,
  output,
  extra,
}: {
  role: DebateAgentRole;
  output: string;
  extra?: string;
}) {
  const [collapsed, setCollapsed] = useState(output.length > 500);
  const config = ROLE_CONFIG[role];

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-300">
          {config.emoji} {config.label}
        </span>
      </div>
      <div className={`text-sm text-gray-400 whitespace-pre-wrap ${collapsed ? "max-h-32 overflow-hidden relative" : ""}`}>
        {output}
        {collapsed && (
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-gray-950 to-transparent" />
        )}
      </div>
      {output.length > 500 && (
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-xs text-blue-400 hover:text-blue-300 mt-2"
        >
          {collapsed ? "Показать полностью ▼" : "Свернуть ▲"}
        </button>
      )}
    </div>
  );
}
