"use client";

import { useState, useCallback } from "react";
import type { ProjectState } from "@/lib/types";

interface Props {
  projectId: string;
  state: ProjectState;
}

export default function PreviewPanel({ projectId, state }: Props) {
  const [loading, setLoading] = useState(false);

  const preview = state.preview;
  const isWebProject = state.is_web_project;

  const handleAction = useCallback(
    async (action: "start" | "stop") => {
      setLoading(true);
      try {
        await fetch(`/api/state/${encodeURIComponent(projectId)}/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
      } finally {
        // State will update via polling — just reset local loading
        setTimeout(() => setLoading(false), 2000);
      }
    },
    [projectId]
  );

  if (!isWebProject) return null;

  // Starting state
  if (preview?.status === "starting" || loading) {
    return (
      <div className="rounded-xl border border-yellow-800/50 bg-yellow-950/20 p-5">
        <div className="flex items-center gap-3">
          <div className="animate-spin h-5 w-5 border-2 border-yellow-400 border-t-transparent rounded-full" />
          <div>
            <h3 className="font-semibold text-yellow-300">Запуск preview...</h3>
            <p className="text-xs text-yellow-500 mt-0.5">
              Агент создаёт Docker-конфигурацию, собирает образ и проверяет здоровье контейнеров
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Running state
  if (preview?.status === "running" && preview.url) {
    return (
      <div className="rounded-xl border border-green-800/50 bg-green-950/20 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-green-300">Preview запущен</h3>
            <a
              href={preview.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-green-400 hover:text-green-300 underline underline-offset-2 mt-1 inline-block"
            >
              {preview.url} ↗
            </a>
            {preview.ports && (
              <p className="text-xs text-green-600 mt-1">
                Порты: app={preview.ports.app}
                {preview.ports.db ? `, db=${preview.ports.db}` : ""}
              </p>
            )}
          </div>
          <button
            onClick={() => handleAction("stop")}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors"
          >
            Остановить
          </button>
        </div>
      </div>
    );
  }

  // Failed state
  if (preview?.status === "failed") {
    return (
      <div className="rounded-xl border border-red-800/50 bg-red-950/20 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-red-300">Preview: ошибка запуска</h3>
          <button
            onClick={() => handleAction("start")}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors"
          >
            Повторить
          </button>
        </div>
        {preview.error && (
          <p className="text-sm text-red-400 mb-2">{preview.error}</p>
        )}
        {preview.logs && (
          <pre className="text-xs text-red-300/70 whitespace-pre-wrap font-mono bg-red-950/50 rounded-lg p-3 max-h-48 overflow-y-auto border border-red-800/30">
            {preview.logs}
          </pre>
        )}
      </div>
    );
  }

  // Default: show start button (no preview or stopped)
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-white">Docker Preview</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Запустить проект в Docker-контейнере для просмотра в браузере
          </p>
        </div>
        <button
          onClick={() => handleAction("start")}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-500 transition-colors"
        >
          ▶ Запустить preview
        </button>
      </div>
    </div>
  );
}
