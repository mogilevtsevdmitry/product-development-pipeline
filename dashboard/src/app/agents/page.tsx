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

  // Modal state
  const [modal, setModal] = useState<{
    type: "toggle" | "delete";
    agentId: string;
    agentName: string;
    enabled?: boolean;
  } | null>(null);
  const [deleteFiles, setDeleteFiles] = useState(false);

  const confirmToggle = async () => {
    if (!modal || modal.type !== "toggle") return;
    await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", agentId: modal.agentId, enabled: modal.enabled }),
    });
    setAgents((prev) =>
      prev.map((a) => (a.id === modal.agentId ? { ...a, enabled: modal.enabled! } : a))
    );
    setModal(null);
  };

  const confirmDelete = async () => {
    if (!modal || modal.type !== "delete") return;
    await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", agentId: modal.agentId, deleteFiles }),
    });
    setModal(null);
    setDeleteFiles(false);
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
                  <Link href={`/agents/${agent.id}`} className="block">
                    <div className="flex items-start justify-between mb-2">
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
                        <span className="relative group/tip text-xs text-gray-500 bg-gray-700/50 px-2 py-0.5 rounded shrink-0 cursor-help">
                          {agent.automationLevel}
                          <span className="absolute bottom-full right-0 mb-2 w-56 p-2.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 leading-relaxed opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible transition-all duration-150 z-50 shadow-xl pointer-events-none">
                            <span className="font-semibold text-white block mb-1">Уровень автоматизации</span>
                            {parseInt(agent.automationLevel) >= 80
                              ? "Почти полностью автономный — минимум ручного контроля"
                              : parseInt(agent.automationLevel) >= 60
                              ? "Автоматизирован частично — ключевые решения принимает человек"
                              : "Низкая автоматизация — требуется активное участие человека"}
                            <span className="absolute -bottom-1 right-4 w-2 h-2 bg-gray-900 border-r border-b border-gray-700 rotate-45" />
                          </span>
                        </span>
                      )}
                    </div>
                    {agent.role && (
                      <p className="text-sm text-gray-400 mb-3 line-clamp-2">
                        {agent.role}
                      </p>
                    )}
                  </Link>

                  {/* Bottom row: status + action buttons */}
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-700/30">
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span className={agent.hasSystemPrompt ? "text-green-500" : "text-red-500"}>
                        {agent.hasSystemPrompt ? "Промпт" : "Нет промпта"}
                      </span>
                      <span className={agent.hasRules ? "text-green-500" : "text-red-500"}>
                        {agent.hasRules ? "Правила" : "Нет правил"}
                      </span>
                      {agent.skillsCount > 0 && (
                        <span className="text-blue-400">
                          {agent.skillsCount} скилл{agent.skillsCount > 1 ? "ов" : ""}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setModal({
                            type: "toggle",
                            agentId: agent.id,
                            agentName: agent.name,
                            enabled: !agent.enabled,
                          });
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
                          e.preventDefault();
                          e.stopPropagation();
                          setModal({
                            type: "delete",
                            agentId: agent.id,
                            agentName: agent.name,
                          });
                        }}
                        title="Удалить"
                        className="p-1.5 rounded-lg text-xs hover:bg-red-500/20 text-red-400 transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Confirmation Modal */}
      {modal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]"
          onClick={() => { setModal(null); setDeleteFiles(false); }}
        >
          <div
            className="bg-gray-800 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {modal.type === "toggle" ? (
              <>
                <h3 className="text-lg font-semibold mb-3">
                  {modal.enabled ? "Включить" : "Отключить"} агента?
                </h3>
                <p className="text-gray-400 text-sm mb-2">
                  Агент: <span className="text-white font-medium">{modal.agentName}</span>
                </p>
                <p className="text-gray-400 text-sm mb-6">
                  {modal.enabled
                    ? "Агент станет доступен для включения в пайплайн новых проектов."
                    : "Отключённый агент не будет включаться в пайплайн новых проектов. Текущие проекты не затронуты."}
                </p>
                <div className="flex items-center justify-end gap-3">
                  <button
                    onClick={() => { setModal(null); setDeleteFiles(false); }}
                    className="px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors"
                  >
                    Отмена
                  </button>
                  <button
                    onClick={confirmToggle}
                    className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                      modal.enabled
                        ? "bg-green-600 hover:bg-green-500 text-white"
                        : "bg-yellow-600 hover:bg-yellow-500 text-white"
                    }`}
                  >
                    {modal.enabled ? "Включить" : "Отключить"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold mb-3 text-red-400">
                  Удалить агента?
                </h3>
                <p className="text-gray-400 text-sm mb-2">
                  Агент: <span className="text-white font-medium">{modal.agentName}</span>
                </p>
                <p className="text-gray-400 text-sm mb-4">
                  Это действие нельзя отменить. Агент будет удалён из конфигурации.
                </p>
                <label className="flex items-center gap-2.5 text-sm text-gray-300 mb-6 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={deleteFiles}
                    onChange={(e) => setDeleteFiles(e.target.checked)}
                    className="rounded border-gray-600 bg-gray-900 text-red-500 focus:ring-red-500"
                  />
                  Также удалить файлы с диска (system-prompt.md, rules.md, skills/)
                </label>
                <div className="flex items-center justify-end gap-3">
                  <button
                    onClick={() => { setModal(null); setDeleteFiles(false); }}
                    className="px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors"
                  >
                    Отмена
                  </button>
                  <button
                    onClick={confirmDelete}
                    className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                  >
                    Удалить
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
