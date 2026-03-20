"use client";

import { useEffect, useState } from "react";

// Map agent phases for file paths
const PHASE_MAP: Record<string, string> = {
  исследование: "research",
  продукт: "product",
  мета: "meta",
  юридическое: "legal",
  дизайн: "design",
  разработка: "development",
  качество: "quality",
  релиз: "release",
  маркетинг: "marketing",
  фидбек: "feedback",
};

interface Props {
  projectId: string;
  agentId: string;
  agentStatus: string;
  phase: string;
}

export default function ReasoningView({
  projectId,
  agentId,
  agentStatus,
  phase,
}: Props) {
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<
    "reasoning" | "prompt"
  >("reasoning");
  // Auto-switch to prompt tab if reasoning is not available
  const effectiveSection = (!reasoning && prompt) ? "prompt" : activeSection;
  const [error, setError] = useState<string | null>(null);

  const phaseKey = PHASE_MAP[phase] || phase;

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      // Load reasoning log
      try {
        const reasoningPath = `${phaseKey}/${agentId}/_reasoning.md`;
        const res = await fetch(
          `/api/artifact?project=${projectId}&path=${encodeURIComponent(
            reasoningPath
          )}`
        );
        if (res.ok) {
          const data = await res.json();
          setReasoning(data.content);
        } else {
          setReasoning(null);
        }
      } catch {
        setReasoning(null);
      }

      // Load prompt
      try {
        const promptPath = `${phaseKey}/${agentId}/_prompt.md`;
        const res = await fetch(
          `/api/artifact?project=${projectId}&path=${encodeURIComponent(
            promptPath
          )}`
        );
        if (res.ok) {
          const data = await res.json();
          setPrompt(data.content);
        } else {
          setPrompt(null);
        }
      } catch {
        setPrompt(null);
      }

      setLoading(false);
    }
    load();
  }, [projectId, agentId, phaseKey]);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-800 rounded w-1/3" />
          <div className="h-32 bg-gray-800 rounded" />
        </div>
      </div>
    );
  }

  if (!reasoning && !prompt) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <div className="text-center py-12">
          <span className="text-4xl mb-4 block">🧠</span>
          <h3 className="text-lg font-medium text-gray-300 mb-2">
            Нет данных о рассуждении
          </h3>
          <p className="text-sm text-gray-500">
            {agentStatus === "pending"
              ? "Агент ещё не запускался. Логи появятся после запуска."
              : agentStatus === "running"
              ? "Агент работает. Логи появятся после завершения."
              : "Логи для этого агента не найдены. Возможно, он был запущен до добавления логирования."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveSection("reasoning")}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
            activeSection === "reasoning"
              ? "bg-purple-900/50 text-purple-300 border border-purple-700/50"
              : "text-gray-500 hover:text-gray-300 border border-gray-800 hover:border-gray-600"
          }`}
        >
          📝 Полный лог
        </button>
        <button
          onClick={() => setActiveSection("prompt")}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
            activeSection === "prompt"
              ? "bg-blue-900/50 text-blue-300 border border-blue-700/50"
              : "text-gray-500 hover:text-gray-300 border border-gray-800 hover:border-gray-600"
          }`}
        >
          📨 Входные данные
        </button>
      </div>

      {/* Content */}
      {effectiveSection === "reasoning" && reasoning && (
        <ReasoningContent content={reasoning} />
      )}
      {effectiveSection === "reasoning" && !reasoning && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-6 text-center">
          <p className="text-gray-500 text-sm">
            Лог рассуждения не найден.
            {prompt && " Переключитесь на «Входные данные» чтобы увидеть промпт."}
          </p>
        </div>
      )}

      {effectiveSection === "prompt" && prompt && (
        <PromptContent content={prompt} />
      )}
      {effectiveSection === "prompt" && !prompt && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-6 text-center">
          <p className="text-gray-500 text-sm">
            Входной промпт не найден
          </p>
        </div>
      )}
    </div>
  );
}

function ReasoningContent({ content }: { content: string }) {
  // Parse sections from the reasoning log
  const sections = parseSections(content);

  return (
    <div className="space-y-4">
      {/* Meta info */}
      {sections.meta && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            {sections.meta.map((item, i) => (
              <div key={i}>
                <dt className="text-gray-500 text-xs">{item.label}</dt>
                <dd className="text-gray-200 font-medium mt-0.5">
                  {item.value}
                </dd>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Model response */}
      {sections.response && (
        <div className="rounded-xl border border-purple-800/40 bg-gray-900 p-6">
          <h4 className="font-semibold text-purple-300 mb-3 flex items-center gap-2">
            <span>🤖</span> Ответ модели
          </h4>
          <div className="prose prose-invert prose-sm max-w-none text-gray-300 whitespace-pre-wrap leading-relaxed overflow-x-auto">
            {sections.response}
          </div>
        </div>
      )}

      {/* Errors */}
      {sections.errors && (
        <div className="rounded-xl border border-red-800/40 bg-red-950/20 p-6">
          <h4 className="font-semibold text-red-400 mb-3 flex items-center gap-2">
            <span>⚠️</span> Ошибки
          </h4>
          <pre className="text-sm text-red-300 whitespace-pre-wrap font-mono bg-red-950/30 rounded-lg p-4">
            {sections.errors}
          </pre>
        </div>
      )}

      {/* Full raw log (collapsible) */}
      <details className="rounded-xl border border-gray-800 bg-gray-900">
        <summary className="p-4 cursor-pointer text-sm text-gray-400 hover:text-gray-300 transition-colors select-none">
          📜 Показать полный лог ({content.length.toLocaleString()} символов)
        </summary>
        <div className="p-4 pt-0 border-t border-gray-800">
          <pre className="text-xs text-gray-400 whitespace-pre-wrap font-mono leading-relaxed max-h-[600px] overflow-y-auto">
            {content}
          </pre>
        </div>
      </details>
    </div>
  );
}

function PromptContent({ content }: { content: string }) {
  return (
    <div className="space-y-4">
      {/* Prompt stats */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-gray-500 text-xs">Символов</dt>
            <dd className="text-gray-200 font-medium mt-0.5">
              {content.length.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500 text-xs">Строк</dt>
            <dd className="text-gray-200 font-medium mt-0.5">
              {content.split("\n").length.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500 text-xs">~Токенов</dt>
            <dd className="text-gray-200 font-medium mt-0.5">
              {Math.round(content.length / 4).toLocaleString()}
            </dd>
          </div>
        </div>
      </div>

      {/* Prompt sections */}
      <div className="rounded-xl border border-blue-800/40 bg-gray-900">
        <div className="p-6">
          <h4 className="font-semibold text-blue-300 mb-3 flex items-center gap-2">
            <span>📨</span> Промпт, отправленный агенту
          </h4>
          <div className="prose prose-invert prose-sm max-w-none text-gray-300 whitespace-pre-wrap leading-relaxed max-h-[800px] overflow-y-auto overflow-x-auto">
            {content}
          </div>
        </div>
      </div>
    </div>
  );
}

// Parse the reasoning log into structured sections
function parseSections(content: string): {
  meta?: { label: string; value: string }[];
  response?: string;
  errors?: string;
} {
  const result: ReturnType<typeof parseSections> = {};

  // Extract meta fields
  const metaFields: { label: string; value: string }[] = [];
  const timeMatch = content.match(
    /\*\*Время запуска:\*\*\s*(.+)/
  );
  const durationMatch = content.match(
    /\*\*Длительность:\*\*\s*(.+)/
  );
  const codeMatch = content.match(
    /\*\*Код выхода:\*\*\s*(.+)/
  );

  if (timeMatch) {
    try {
      metaFields.push({
        label: "Запущен",
        value: new Date(timeMatch[1].trim()).toLocaleString("ru-RU"),
      });
    } catch {
      metaFields.push({ label: "Запущен", value: timeMatch[1].trim() });
    }
  }
  if (durationMatch)
    metaFields.push({
      label: "Длительность",
      value: durationMatch[1].trim(),
    });
  if (codeMatch) {
    const code = codeMatch[1].trim();
    metaFields.push({
      label: "Код выхода",
      value: code === "0" ? "✅ 0 (успех)" : `❌ ${code} (ошибка)`,
    });
  }
  if (metaFields.length > 0) result.meta = metaFields;

  // Extract model response
  const responseMatch = content.match(
    /## Ответ модели\s*\n([\s\S]*?)(?=\n## |---\s*$|\n\*Лог сохранён)/
  );
  if (responseMatch) {
    result.response = responseMatch[1].trim();
  }

  // Extract errors
  const errorMatch = content.match(
    /## Stderr \/ Ошибки\s*\n```\s*\n([\s\S]*?)\n```/
  );
  if (errorMatch) {
    result.errors = errorMatch[1].trim();
  }

  return result;
}
