"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface AgentInfo {
  id: string;
  name: string;
  phase: string;
  role: string;
  automationLevel: string;
  enabled: boolean;
  hasSystemPrompt: boolean;
  hasRules: boolean;
  skillsCount: number;
}

const PHASE_LABELS: Record<string, string> = {
  meta: "Мета",
  research: "Исследование",
  product: "Продукт",
  legal: "Юридическое",
  design: "Дизайн",
  development: "Разработка",
  quality: "Качество",
  release: "Релиз",
  marketing: "Маркетинг",
  feedback: "Фидбек",
};

const PHASE_COLORS: Record<string, string> = {
  meta: "text-purple-400",
  research: "text-cyan-400",
  product: "text-blue-400",
  legal: "text-yellow-400",
  design: "text-pink-400",
  development: "text-green-400",
  quality: "text-orange-400",
  release: "text-red-400",
  marketing: "text-emerald-400",
  feedback: "text-indigo-400",
};

const PHASE_OPTIONS = Object.entries(PHASE_LABELS).map(([key, label]) => ({
  value: key,
  label,
}));

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showDisabled, setShowDisabled] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newAgent, setNewAgent] = useState({ id: "", name: "", phase: "development", role: "" });
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d) => {
        setAgents(d.agents || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleAgent = async (agentId: string, enabled: boolean) => {
    await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", agentId, enabled }),
    });
    setAgents((prev) =>
      prev.map((a) => (a.id === agentId ? { ...a, enabled } : a))
    );
  };

  const deleteAgent = async (agentId: string, agentName: string) => {
    const deleteFiles = confirm(
      `Удалить файлы агента "${agentName}" с диска?\n\nОК = удалить файлы\nОтмена = только убрать из конфигурации`
    );

    if (!confirm(`Точно удалить агента "${agentName}"?`)) return;

    await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", agentId, deleteFiles }),
    });
    load();
  };

  const createAgent = async () => {
    if (!newAgent.id.trim() || !newAgent.phase) return;
    setCreating(true);
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        agentId: newAgent.id.trim(),
        name: newAgent.name.trim() || newAgent.id.trim(),
        phase: newAgent.phase,
        role: newAgent.role.trim(),
      }),
    });
    const data = await res.json();
    if (data.ok) {
      setShowCreateForm(false);
      setNewAgent({ id: "", name: "", phase: "development", role: "" });
      load();
    } else {
      alert(data.error || "Ошибка создания");
    }
    setCreating(false);
  };

  const filtered = agents.filter((a) => {
    if (!showDisabled && !a.enabled) return false;
    const q = search.toLowerCase();
    return (
      a.name.toLowerCase().includes(q) ||
      a.role.toLowerCase().includes(q) ||
      a.phase.toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q)
    );
  });

  const enabledCount = agents.filter((a) => a.enabled).length;
  const disabledCount = agents.filter((a) => !a.enabled).length;

  const grouped = filtered.reduce<Record<string, AgentInfo[]>>((acc, a) => {
    if (!acc[a.phase]) acc[a.phase] = [];
    acc[a.phase].push(a);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-gray-800 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Агенты</h1>
          <p className="text-gray-400 mt-1">
            {enabledCount} активных
            {disabledCount > 0 && (
              <span className="text-gray-500"> / {disabledCount} отключено</span>
            )}
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-4 py-2 bg-blue-600 text-sm rounded-lg hover:bg-blue-500 transition-colors"
        >
          + Новый агент
        </button>
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 mb-6">
          <h3 className="font-semibold mb-4">Создание нового агента</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                ID агента (латиница, через дефис)
              </label>
              <input
                type="text"
                value={newAgent.id}
                onChange={(e) =>
                  setNewAgent((p) => ({ ...p, id: e.target.value }))
                }
                placeholder="my-custom-agent"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Отображаемое имя
              </label>
              <input
                type="text"
                value={newAgent.name}
                onChange={(e) =>
                  setNewAgent((p) => ({ ...p, name: e.target.value }))
                }
                placeholder="My Custom Agent"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Фаза</label>
              <select
                value={newAgent.phase}
                onChange={(e) =>
                  setNewAgent((p) => ({ ...p, phase: e.target.value }))
                }
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {PHASE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Роль</label>
              <input
                type="text"
                value={newAgent.role}
                onChange={(e) =>
                  setNewAgent((p) => ({ ...p, role: e.target.value }))
                }
                placeholder="Описание роли агента"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={createAgent}
              disabled={creating || !newAgent.id.trim()}
              className="px-4 py-2 bg-green-600 text-sm rounded-lg hover:bg-green-500 disabled:opacity-50"
            >
              {creating ? "Создание..." : "Создать агента"}
            </button>
            <button
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Search & filters */}
      <div className="flex items-center gap-4 mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по имени, роли или фазе..."
          className="flex-1 max-w-md bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        {disabledCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showDisabled}
              onChange={(e) => setShowDisabled(e.target.checked)}
              className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
            />
            Показать отключённые
          </label>
        )}
      </div>

      {/* Agents by phase */}
      <div className="space-y-8">
        {Object.entries(grouped).map(([phase, phaseAgents]) => (
          <div key={phase}>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <span className={PHASE_COLORS[phase] || "text-gray-400"}>
                {PHASE_LABELS[phase] || phase}
              </span>
              <span className="text-sm text-gray-500 font-normal">
                ({phaseAgents.filter((a) => a.enabled).length}/
                {phaseAgents.length})
              </span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {phaseAgents.map((agent) => (
                <div
                  key={agent.id}
                  className={`relative bg-gray-800/50 border rounded-xl p-5 transition-all group ${
                    agent.enabled
                      ? "border-gray-700/50 hover:border-gray-600 hover:bg-gray-800"
                      : "border-gray-800/50 opacity-50"
                  }`}
                >
                  {/* Toggle & delete buttons */}
                  <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleAgent(agent.id, !agent.enabled);
                      }}
                      title={agent.enabled ? "Отключить" : "Включить"}
                      className={`p-1.5 rounded-lg text-xs transition-colors ${
                        agent.enabled
                          ? "hover:bg-yellow-500/20 text-yellow-400"
                          : "hover:bg-green-500/20 text-green-400"
                      }`}
                    >
                      {agent.enabled ? "⏸" : "▶"}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteAgent(agent.id, agent.name);
                      }}
                      title="Удалить"
                      className="p-1.5 rounded-lg text-xs hover:bg-red-500/20 text-red-400 transition-colors"
                    >
                      ✕
                    </button>
                  </div>

                  <Link href={`/agents/${agent.id}`} className="block">
                    <div className="flex items-start justify-between mb-2 pr-16">
                      <div className="flex items-center gap-2">
                        {!agent.enabled && (
                          <span className="text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">
                            OFF
                          </span>
                        )}
                        <h3
                          className={`font-semibold transition-colors ${
                            agent.enabled
                              ? "text-white group-hover:text-blue-400"
                              : "text-gray-500"
                          }`}
                        >
                          {agent.name}
                        </h3>
                      </div>
                      {agent.automationLevel && (
                        <span className="text-xs text-gray-500 bg-gray-700/50 px-2 py-0.5 rounded shrink-0">
                          {agent.automationLevel}
                        </span>
                      )}
                    </div>
                    {agent.role && (
                      <p className="text-sm text-gray-400 mb-3 line-clamp-2">
                        {agent.role}
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span
                        className={
                          agent.hasSystemPrompt ? "text-green-500" : "text-red-500"
                        }
                      >
                        {agent.hasSystemPrompt ? "Промпт" : "Нет промпта"}
                      </span>
                      <span
                        className={
                          agent.hasRules ? "text-green-500" : "text-red-500"
                        }
                      >
                        {agent.hasRules ? "Правила" : "Нет правил"}
                      </span>
                      {agent.skillsCount > 0 && (
                        <span className="text-blue-400">
                          {agent.skillsCount} скилл
                          {agent.skillsCount > 1 ? "ов" : ""}
                        </span>
                      )}
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
