"use client";

import { useEffect, useState, useRef, use } from "react";
import StatusBadge from "@/components/StatusBadge";
import ArtifactViewer from "@/components/ArtifactViewer";
import RevisionChat from "@/components/RevisionChat";
import ReasoningView from "@/components/ReasoningView";
import FeedbackPanel from "@/components/FeedbackPanel";
import FeedbackReceivedBlock from "@/components/FeedbackReceivedBlock";
import RunHistoryView from "@/components/RunHistoryView";
import type { ProjectState, AgentStatus, AgentRunRecord } from "@/lib/types";

type Tab = "overview" | "reasoning" | "history";

// Agent display names
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
  orchestrator: "Orchestrator",
};

const AGENT_PHASES: Record<string, string> = {
  "problem-researcher": "Исследование",
  "market-researcher": "Исследование",
  "product-owner": "Продукт",
  "pipeline-architect": "Мета",
  "business-analyst": "Продукт",
  "legal-compliance": "Юридическое",
  "ux-ui-designer": "Дизайн",
  "system-architect": "Разработка",
  "tech-lead": "Разработка",
  "backend-developer": "Разработка",
  "frontend-developer": "Разработка",
  "devops-engineer": "Разработка",
  "qa-engineer": "Качество",
  "security-engineer": "Качество",
  "release-manager": "Релиз",
  "product-marketer": "Маркетинг",
  "smm-manager": "Маркетинг",
  "content-creator": "Маркетинг",
  "customer-support": "Фидбек",
  "data-analyst": "Фидбек",
  orchestrator: "Мета",
};

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * Find dependencies for an agent from the graph edges.
 */
function getDependencies(
  agentId: string,
  edges: [string, string][]
): string[] {
  return edges.filter(([, tgt]) => tgt === agentId).map(([src]) => src);
}

export default function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string; name: string }>;
}) {
  const { id, name } = use(params);
  const [state, setState] = useState<ProjectState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [openArtifact, setOpenArtifact] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const lastJsonRef = useRef<string>("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/state/${id}`);
        if (!res.ok) {
          setError("Проект не найден");
          return;
        }
        const text = await res.text();
        if (text !== lastJsonRef.current) {
          lastJsonRef.current = text;
          setState(JSON.parse(text));
        }
      } catch {
        setError("Ошибка загрузки");
      }
    }
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [id]);

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-20">
          <h2 className="text-lg font-medium text-red-400">{error}</h2>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-800 rounded w-1/3" />
          <div className="h-48 bg-gray-900 rounded-xl border border-gray-800" />
        </div>
      </div>
    );
  }

  const agentKey = decodeURIComponent(name);
  const agent = state.agents[agentKey];
  const label = AGENT_LABELS[agentKey] || agentKey;
  const phase = AGENT_PHASES[agentKey] || "—";
  const dependencies = getDependencies(agentKey, state.pipeline_graph.edges);

  if (!agent) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-20">
          <h2 className="text-lg font-medium text-red-400">
            Агент &quot;{agentKey}&quot; не найден
          </h2>
          <a
            href={`/project/${id}`}
            className="text-blue-400 text-sm mt-2 inline-block hover:underline"
          >
            ← Вернуться к проекту
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm mb-6">
        <a
          href="/"
          className="text-gray-500 hover:text-gray-300 transition-colors"
        >
          Проекты
        </a>
        <span className="text-gray-600">/</span>
        <a
          href={`/project/${id}`}
          className="text-gray-500 hover:text-gray-300 transition-colors"
        >
          {state.name}
        </a>
        <span className="text-gray-600">/</span>
        <span className="text-gray-300">{label}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{label}</h1>
          <p className="text-gray-500 text-sm font-mono mt-1">{agentKey}</p>
        </div>
        <div className="flex items-center gap-3">
          {(agent.status === "running" || (agent.status === "pending" && agent.error === "Принудительно остановлен")) && (
            <button
              onClick={async () => {
                if (agent.status === "running" && !confirm("Принудительно остановить агента? Процесс будет убит.")) return;
                await fetch(`/api/state/${id}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "kill_agent", agentId: agentKey }),
                });
                const res = await fetch(`/api/state/${id}`);
                if (res.ok) setState(await res.json());
              }}
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors"
            >
              ⏹ Остановить
            </button>
          )}
          <StatusBadge status={agent.status as AgentStatus} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-800">
        <button
          onClick={() => setTab("overview")}
          className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
            tab === "overview"
              ? "bg-gray-800 text-white border-b-2 border-blue-500"
              : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/50"
          }`}
        >
          📋 Обзор
        </button>
        <button
          onClick={() => setTab("reasoning")}
          className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
            tab === "reasoning"
              ? "bg-gray-800 text-white border-b-2 border-purple-500"
              : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/50"
          }`}
        >
          🧠 Рассуждение
          {(agent.status === "completed" || agent.status === "failed") && (
            <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-purple-400 inline-block" />
          )}
        </button>
        {(agent.run_history && agent.run_history.length > 0) && (
          <button
            onClick={() => setTab("history")}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
              tab === "history"
                ? "bg-gray-800 text-white border-b-2 border-amber-500"
                : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/50"
            }`}
          >
            📜 История ({agent.run_history.length})
          </button>
        )}
      </div>

      {/* Tab: Reasoning */}
      {tab === "reasoning" && (
        <ReasoningView
          projectId={state.project_id}
          agentId={agentKey}
          agentStatus={agent.status}
          phase={AGENT_PHASES[agentKey]?.toLowerCase() || "other"}
        />
      )}

      {/* Tab: History */}
      {tab === "history" && agent.run_history && (
        <RunHistoryView
          projectId={state.project_id}
          agentId={agentKey}
          runHistory={agent.run_history}
          phase={AGENT_PHASES[agentKey]?.toLowerCase() || "other"}
        />
      )}

      {/* Tab: Overview */}
      {tab === "overview" && <div className="space-y-6">
        {/* Main Info */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
          <h3 className="font-semibold text-white mb-4">Основная информация</h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-500 mb-1">Фаза</dt>
              <dd className="text-gray-200 font-medium">{phase}</dd>
            </div>
            <div>
              <dt className="text-gray-500 mb-1">Статус</dt>
              <dd>
                <StatusBadge status={agent.status as AgentStatus} size="sm" />
              </dd>
            </div>
            <div>
              <dt className="text-gray-500 mb-1">Запущен</dt>
              <dd className="text-gray-200">{formatDate(agent.started_at)}</dd>
            </div>
            <div>
              <dt className="text-gray-500 mb-1">Завершён</dt>
              <dd className="text-gray-200">{formatDate(agent.completed_at)}</dd>
            </div>
          </dl>
        </div>

        {/* Usage / Cost */}
        {(agent.total_usage || agent.usage) && (() => {
          const total = agent.total_usage || agent.usage!;
          const history = agent.usage_history || [];
          const runs = history.length || 1;
          return (
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-white">📊 Использование токенов</h3>
                <div className="flex items-center gap-2">
                  {total.model && (
                    <span className={`text-xs px-2 py-1 rounded border ${
                      total.model.includes("opus") ? "bg-purple-900/30 text-purple-400 border-purple-800" :
                      total.model.includes("haiku") ? "bg-green-900/30 text-green-400 border-green-800" :
                      "bg-blue-900/30 text-blue-400 border-blue-800"
                    }`}>
                      {total.model.includes("opus") ? "Opus" :
                       total.model.includes("haiku") ? "Haiku" :
                       total.model.includes("sonnet") ? "Sonnet" : total.model}
                    </span>
                  )}
                  {runs > 1 && (
                    <span className="text-xs px-2 py-1 rounded bg-amber-900/30 text-amber-400 border border-amber-800">
                      {runs} {runs < 5 ? "запуска" : "запусков"} (суммарно)
                    </span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-gray-500 mb-1">Общая стоимость</div>
                  <div className="text-xl font-bold text-amber-400">
                    ${total.cost_usd.toFixed(4)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">Общее время</div>
                  <div className="text-xl font-bold text-blue-400">
                    {total.duration_ms >= 60000
                      ? `${(total.duration_ms / 60000).toFixed(1)}м`
                      : `${(total.duration_ms / 1000).toFixed(1)}с`}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">Input tokens</div>
                  <div className="text-sm text-gray-300">
                    {total.input_tokens.toLocaleString()}
                    {total.cache_creation_tokens > 0 && (
                      <span className="text-xs text-gray-500 block">
                        +{total.cache_creation_tokens.toLocaleString()} cache create
                      </span>
                    )}
                    {total.cache_read_tokens > 0 && (
                      <span className="text-xs text-gray-500 block">
                        +{total.cache_read_tokens.toLocaleString()} cache read
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">Output tokens</div>
                  <div className="text-sm text-gray-300">
                    {total.output_tokens.toLocaleString()}
                  </div>
                </div>
              </div>
              {total.model && (
                <div className="mt-3 text-xs text-gray-500">
                  Модель: {total.model}
                </div>
              )}

              {/* Run history */}
              {history.length > 1 && (
                <div className="mt-4 border-t border-gray-800 pt-4">
                  <div className="text-xs text-gray-500 mb-2">История запусков</div>
                  <div className="space-y-1">
                    {history.map((run, i) => (
                      <div key={i} className="flex items-center justify-between text-xs text-gray-400 py-1 px-2 rounded bg-gray-800/50">
                        <span className="text-gray-500">#{i + 1}</span>
                        <span>${run.cost_usd.toFixed(4)}</span>
                        <span>{(run.duration_ms / 1000).toFixed(1)}с</span>
                        <span>↓{run.input_tokens.toLocaleString()}</span>
                        <span>↑{run.output_tokens.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Dependencies */}
        {dependencies.length > 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
            <h3 className="font-semibold text-white mb-3">Зависимости</h3>
            <div className="flex flex-wrap gap-2">
              {dependencies.map((dep) => {
                const depStatus = state.agents[dep]?.status || "pending";
                return (
                  <a
                    key={dep}
                    href={`/project/${id}/agent/${encodeURIComponent(dep)}`}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-300 hover:border-blue-500 hover:text-blue-400 transition-colors"
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        depStatus === "completed"
                          ? "bg-emerald-400"
                          : depStatus === "running"
                          ? "bg-blue-400"
                          : depStatus === "failed"
                          ? "bg-red-400"
                          : "bg-gray-500"
                      }`}
                    />
                    {AGENT_LABELS[dep] || dep}
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {/* Error + Restart */}
        {(agent.status === "failed" || agent.error) && (
          <div className="rounded-xl border border-red-800/60 bg-red-950/30 p-6">
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-semibold text-red-400">Ошибка</h3>
              <button
                onClick={async () => {
                  setRestarting(true);
                  try {
                    const res = await fetch(`/api/state/${id}`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "restart_agent",
                        agentId: agentKey,
                      }),
                    });
                    if (res.ok) {
                      // Reload state
                      const stateRes = await fetch(`/api/state/${id}`);
                      if (stateRes.ok) setState(await stateRes.json());
                    }
                  } finally {
                    setRestarting(false);
                  }
                }}
                disabled={restarting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50"
              >
                {restarting ? "⏳ Сброс..." : "🔄 Перезапустить"}
              </button>
            </div>
            {agent.error && (
              <pre className="text-sm text-red-300 whitespace-pre-wrap font-mono bg-red-950/50 rounded-lg p-4 border border-red-800/40">
                {agent.error}
              </pre>
            )}
          </div>
        )}

        {/* Artifacts */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
          <h3 className="font-semibold text-white mb-3">Артефакты</h3>
          {agent.artifacts.length === 0 ? (
            <p className="text-gray-500 text-sm">Нет артефактов</p>
          ) : (
            <div className="space-y-2">
              {agent.artifacts.filter((p) => !p.includes("node_modules") && !p.includes(".next/") && !p.includes("__pycache__")).map((artifactPath, i) => {
                const fileName = artifactPath.split("/").pop() || artifactPath;
                const isOpen = openArtifact === artifactPath;
                return (
                  <button
                    key={i}
                    onClick={() =>
                      setOpenArtifact(isOpen ? null : artifactPath)
                    }
                    className={`w-full text-left flex items-center justify-between rounded-lg border px-4 py-3 transition-colors ${
                      isOpen
                        ? "bg-blue-950/30 border-blue-700/50"
                        : "bg-gray-950 border-gray-800 hover:border-gray-600"
                    }`}
                  >
                    <div>
                      <div className="text-sm font-medium text-gray-200">
                        📄 {fileName}
                      </div>
                      <div className="text-xs text-gray-500 font-mono mt-0.5">
                        {artifactPath}
                      </div>
                    </div>
                    <span className="text-xs text-gray-500">
                      {isOpen ? "▼ Закрыть" : "▶ Открыть"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Artifact Viewer */}
        {openArtifact && (
          <ArtifactViewer
            projectId={state.project_id}
            artifactPath={openArtifact}
            onClose={() => setOpenArtifact(null)}
          />
        )}

        {/* Feedback Panel — for QA, Security, DevOps */}
        {agent.status === "completed" && (() => {
          const feedbackRoutes: Record<string, string[]> = {
            "qa-engineer": ["backend-developer", "frontend-developer"],
            "security-engineer": ["backend-developer", "frontend-developer", "devops-engineer"],
            "devops-engineer": ["backend-developer", "frontend-developer"],
          };
          const targets = feedbackRoutes[agentKey];
          if (!targets) return null;
          // Only show targets that are in the pipeline
          const availableTargets = targets.filter(t => state.pipeline_graph.nodes.includes(t));
          if (availableTargets.length === 0) return null;
          return (
            <FeedbackPanel
              projectId={state.project_id}
              fromAgent={agentKey}
              allowedTargets={availableTargets}
            />
          );
        })()}

        {/* Received feedback — show on developers */}
        {agent.feedback_received && agent.feedback_received.length > 0 && (
          <FeedbackReceivedBlock
            feedback={agent.feedback_received}
            agentLabels={AGENT_LABELS}
            agentStatus={agent.status}
            projectId={state.project_id}
            agentId={agentKey}
            onAgentStarted={() => {
              fetch(`/api/state/${id}`).then(r => r.json()).then(setState).catch(() => {});
            }}
          />
        )}

        {/* Start fixing feedback button — for agents returned to pending with unresolved feedback */}
        {agent.status === "pending" && agent.feedback_received?.some(f => !f.resolved) && (
          <div className="rounded-xl border border-yellow-800/50 bg-yellow-900/10 p-6">
            <h3 className="font-semibold text-yellow-400 mb-2">🔧 Требуется исправление замечаний</h3>
            <p className="text-sm text-gray-400 mb-4">
              Агент получил замечания и ожидает запуска для их исправления.
              Нажмите кнопку, чтобы запустить агента — он автоматически получит все нерешённые замечания.
            </p>
            <button
              onClick={async () => {
                try {
                  const res = await fetch(`/api/state/${state.project_id}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "run_agent", agentId: agentKey }),
                  });
                  if (!res.ok) {
                    const data = await res.json();
                    alert(data.error || "Ошибка запуска");
                  }
                } catch (e) {
                  alert("Ошибка запуска агента");
                }
              }}
              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg font-medium transition-colors"
            >
              ▶ Запустить исправление замечаний
            </button>
          </div>
        )}

        {/* Revision Chat — show for completed/running/failed, or pending with feedback */}
        {(agent.status === "completed" || agent.status === "running" || agent.status === "failed" ||
          (agent.status === "pending" && agent.feedback_received?.some(f => !f.resolved))) ? (
          <RevisionChat
            projectId={state.project_id}
            agentId={agentKey}
            agentStatus={agent.status}
          />
        ) : null}
      </div>}
    </div>
  );
}
