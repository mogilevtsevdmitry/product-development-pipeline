"use client";

import { useEffect, useState, use } from "react";
import StatusBadge from "@/components/StatusBadge";
import type { ProjectState, AgentStatus } from "@/lib/types";

function formatDate(iso?: string): string {
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

export default function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string; name: string }>;
}) {
  const { id, name } = use(params);
  const [state, setState] = useState<ProjectState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/state/${id}`);
        if (!res.ok) {
          setError("Проект не найден");
          return;
        }
        const data = await res.json();
        setState(data);
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
  const graphNode = state.pipeline_graph.nodes.find((n) => n.id === agentKey);

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
          {state.project_name}
        </a>
        <span className="text-gray-600">/</span>
        <span className="text-gray-300">{graphNode?.label || agentKey}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {graphNode?.label || agentKey}
          </h1>
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
              <dd className="text-gray-200 font-medium">
                {graphNode?.phase || agent.phase || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500 mb-1">Статус</dt>
              <dd>
                <StatusBadge status={agent.status} size="sm" />
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
        {agent.depends_on && agent.depends_on.length > 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
            <h3 className="font-semibold text-white mb-3">Зависимости</h3>
            <div className="flex flex-wrap gap-2">
              {agent.depends_on.map((dep) => (
                <a
                  key={dep}
                  href={`/project/${id}/agent/${encodeURIComponent(dep)}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-300 hover:border-blue-500 hover:text-blue-400 transition-colors"
                >
                  {dep}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {agent.error && (
          <div className="rounded-xl border border-red-800/60 bg-red-950/30 p-6">
            <h3 className="font-semibold text-red-400 mb-2">Ошибка</h3>
            <pre className="text-sm text-red-300 whitespace-pre-wrap font-mono bg-red-950/50 rounded-lg p-4 border border-red-800/40">
              {agent.error}
            </pre>
          </div>
        )}

        {/* Artifacts */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
          <h3 className="font-semibold text-white mb-3">Артефакты</h3>
          {agent.artifacts.length === 0 ? (
            <p className="text-gray-500 text-sm">Нет артефактов</p>
          ) : (
            <div className="space-y-2">
              {agent.artifacts.map((artifact, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg bg-gray-950 border border-gray-800 px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-medium text-gray-200">
                      {artifact.name}
                    </div>
                    <div className="text-xs text-gray-500 font-mono mt-0.5">
                      {artifact.path}
                    </div>
                  </div>
                  {artifact.type && (
                    <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">
                      {artifact.type}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
