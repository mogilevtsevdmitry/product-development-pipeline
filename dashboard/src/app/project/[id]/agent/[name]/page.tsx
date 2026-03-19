"use client";

import { useEffect, useState, useRef, use } from "react";
import StatusBadge from "@/components/StatusBadge";
import ArtifactViewer from "@/components/ArtifactViewer";
import RevisionChat from "@/components/RevisionChat";
import type { ProjectState, AgentStatus } from "@/lib/types";

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
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">{label}</h1>
          <p className="text-gray-500 text-sm font-mono mt-1">{agentKey}</p>
        </div>
        <StatusBadge status={agent.status as AgentStatus} />
      </div>

      {/* Details */}
      <div className="space-y-6">
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
              {agent.artifacts.map((artifactPath, i) => {
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

        {/* Revision Chat */}
        {agent.status === "completed" || agent.status === "running" || agent.status === "failed" ? (
          <RevisionChat
            projectId={state.project_id}
            agentId={agentKey}
            agentStatus={agent.status}
          />
        ) : null}
      </div>
    </div>
  );
}
