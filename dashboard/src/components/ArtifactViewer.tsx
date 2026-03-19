"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ArtifactViewerProps {
  projectId: string;
  artifactPath: string;
  onClose: () => void;
}

export default function ArtifactViewer({
  projectId,
  artifactPath,
  onClose,
}: ArtifactViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fileName = artifactPath.split("/").pop() || artifactPath;

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/artifact?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(artifactPath)}`
        );
        if (!res.ok) {
          setError("Файл не найден");
          return;
        }
        const data = await res.json();
        setContent(data.content);
        setError(null);
      } catch {
        setError("Ошибка загрузки");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [projectId, artifactPath]);

  // Reload content periodically (agent may update it during revision)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/artifact?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(artifactPath)}`
        );
        if (res.ok) {
          const data = await res.json();
          setContent(data.content);
        }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [projectId, artifactPath]);

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-950 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-2">
          <span className="text-sm">📄</span>
          <span className="text-sm font-medium text-white">{fileName}</span>
          <span className="text-xs text-gray-500 font-mono">{artifactPath}</span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 transition-colors text-lg leading-none"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="p-6 max-h-[600px] overflow-y-auto">
        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-gray-800 rounded w-3/4" />
            <div className="h-4 bg-gray-800 rounded w-1/2" />
            <div className="h-4 bg-gray-800 rounded w-5/6" />
            <div className="h-4 bg-gray-800 rounded w-2/3" />
          </div>
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
