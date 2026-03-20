"use client";

import { useEffect, useState, useRef } from "react";

interface RevisionEntry {
  role: "human" | "agent";
  message: string;
  timestamp: string;
}

interface RevisionChatProps {
  projectId: string;
  agentId: string;
  agentStatus: string;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      day: "numeric",
      month: "short",
    });
  } catch {
    return iso;
  }
}

export default function RevisionChat({
  projectId,
  agentId,
  agentStatus,
}: RevisionChatProps) {
  const [history, setHistory] = useState<RevisionEntry[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);
  const lastRevJsonRef = useRef<string>("");

  // Load revision history
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(
          `/api/revision?project=${encodeURIComponent(projectId)}&agent=${encodeURIComponent(agentId)}`
        );
        if (res.ok) {
          const text = await res.text();
          if (text !== lastRevJsonRef.current) {
            lastRevJsonRef.current = text;
            setHistory(JSON.parse(text));
          }
        }
      } catch { /* skip */ }
    }
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [projectId, agentId]);

  // Auto-scroll only when NEW messages are added
  useEffect(() => {
    if (history.length > prevCountRef.current) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevCountRef.current = history.length;
  }, [history.length]);

  async function handleSend() {
    if (!message.trim() || sending) return;

    setSending(true);
    try {
      const res = await fetch("/api/revision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          agentId,
          message: message.trim(),
        }),
      });

      if (res.ok) {
        setMessage("");
        // Immediately add to local history for instant feedback
        setHistory((prev) => [
          ...prev,
          {
            role: "human",
            message: message.trim(),
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    } finally {
      setSending(false);
    }
  }

  const isAgentWorking = agentStatus === "running";

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800">
        <h3 className="font-semibold text-white text-sm flex items-center gap-2">
          💬 Правки и ревизии
          {isAgentWorking && (
            <span className="inline-flex items-center gap-1 text-xs text-blue-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
              </span>
              Агент обрабатывает...
            </span>
          )}
        </h3>
      </div>

      {/* Chat messages */}
      <div className="max-h-[400px] overflow-y-auto p-4 space-y-3">
        {history.length === 0 && !isAgentWorking ? (
          <p className="text-gray-500 text-sm text-center py-4">
            Прочитайте артефакт выше и напишите правки, если нужно.
            <br />
            <span className="text-xs text-gray-600">
              Агент получит свой отчёт + ваши правки и обновит артефакты.
            </span>
          </p>
        ) : (
          history.map((entry, i) => (
            <div
              key={i}
              className={`flex ${
                entry.role === "human" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 ${
                  entry.role === "human"
                    ? "bg-blue-600/20 border border-blue-700/40 text-blue-100"
                    : "bg-gray-800 border border-gray-700 text-gray-200"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium">
                    {entry.role === "human" ? "👤 Вы" : "🤖 Агент"}
                  </span>
                  <span className="text-xs text-gray-500">
                    {formatTime(entry.timestamp)}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{entry.message}</p>
              </div>
            </div>
          ))
        )}

        {isAgentWorking && (
          <div className="flex justify-start">
            <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-400">
                  🤖 Агент
                </span>
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "0s" }} />
                  <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "0.15s" }} />
                  <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "0.3s" }} />
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-800 p-4">
        <div className="flex gap-2 items-end">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Задайте вопрос или опишите задачу... (Enter — отправить, Shift+Enter — новая строка)"
            rows={4}
            disabled={sending || isAgentWorking}
            className="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y min-h-[100px] max-h-[400px] disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!message.trim() || sending || isAgentWorking}
            className="px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {sending ? "⏳" : "→"}
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-1.5">
          Можно задавать вопросы, давать задачи или просить уточнения
        </p>
      </div>
    </div>
  );
}
