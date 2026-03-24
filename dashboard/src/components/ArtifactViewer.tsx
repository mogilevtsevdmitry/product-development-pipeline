"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ArtifactViewerProps {
  projectId: string;
  artifactPath: string;
  onClose?: () => void;
  runDir?: string;  // e.g. "quality/qa-engineer/runs/001" — load from run folder instead
}

export default function ArtifactViewer({
  projectId,
  artifactPath,
  onClose,
  runDir,
}: ArtifactViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const lastContentRef = useRef<string>("");

  const fileName = artifactPath.split("/").pop() || artifactPath;

  const loadContent = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/artifact?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(artifactPath)}${runDir ? `&runDir=${encodeURIComponent(runDir)}` : ""}`
      );
      if (!res.ok) {
        setError("Файл не найден");
        return;
      }
      const data = await res.json();
      if (data.content !== lastContentRef.current) {
        lastContentRef.current = data.content;
        setContent(data.content);
      }
      setError(null);
    } catch {
      setError("Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [projectId, artifactPath]);

  useEffect(() => {
    setLoading(true);
    loadContent();
  }, [loadContent]);

  // Reload periodically
  useEffect(() => {
    const interval = setInterval(loadContent, 5000);
    return () => clearInterval(interval);
  }, [loadContent]);

  // Close fullscreen on Escape
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [expanded]);

  // Fullscreen overlay
  if (expanded) {
    return (
      <div className="fixed inset-0 z-50 bg-gray-950/95 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800 bg-gray-900 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm">📄</span>
            <span className="text-sm font-medium text-white">{fileName}</span>
            <span className="text-xs text-gray-500 font-mono">
              {artifactPath}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setExpanded(false)}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors"
            >
              ↙ Свернуть
            </button>
            <button
              onClick={() => onClose?.()}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors"
            >
              ✕ Закрыть
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-5xl mx-auto">
            {loading ? (
              <Skeleton />
            ) : error ? (
              <p className="text-red-400 text-sm">{error}</p>
            ) : (
              <div className="prose prose-invert prose-base max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {content || ""}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Inline view
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-950 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm shrink-0">📄</span>
          <span className="text-sm font-medium text-white truncate">
            {fileName}
          </span>
          <span className="text-xs text-gray-500 font-mono truncate hidden sm:inline">
            {artifactPath}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setExpanded(true)}
            className="px-2 py-1 text-xs text-gray-500 hover:text-white border border-gray-700 rounded hover:bg-gray-800 transition-colors"
            title="Развернуть на весь экран"
          >
            ↗ Развернуть
          </button>
          <button
            onClick={() => onClose?.()}
            className="px-2 py-1 text-xs text-gray-500 hover:text-white border border-gray-700 rounded hover:bg-gray-800 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 max-h-[600px] overflow-auto">
        {loading ? (
          <Skeleton />
        ) : error ? (
          <p className="text-red-400 text-sm">{error}</p>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content || ""}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 bg-gray-800 rounded w-3/4" />
      <div className="h-4 bg-gray-800 rounded w-1/2" />
      <div className="h-4 bg-gray-800 rounded w-5/6" />
      <div className="h-4 bg-gray-800 rounded w-2/3" />
    </div>
  );
}
