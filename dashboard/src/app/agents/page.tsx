"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface AgentInfo {
  id: string;
  name: string;
  phase: string;
  role: string;
  automationLevel: string;
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

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d) => {
        setAgents(d.agents || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.role.toLowerCase().includes(search.toLowerCase()) ||
      a.phase.toLowerCase().includes(search.toLowerCase())
  );

  // Group by phase
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Агенты</h1>
          <p className="text-gray-400 mt-1">
            {agents.length} агентов в пайплайне
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по имени, роли или фазе..."
          className="w-full max-w-md bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
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
                ({phaseAgents.length})
              </span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {phaseAgents.map((agent) => (
                <Link
                  key={agent.id}
                  href={`/agents/${agent.id}`}
                  className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 hover:border-gray-600 hover:bg-gray-800 transition-all group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-white group-hover:text-blue-400 transition-colors">
                      {agent.name}
                    </h3>
                    {agent.automationLevel && (
                      <span className="text-xs text-gray-500 bg-gray-700/50 px-2 py-0.5 rounded">
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
                      className={`${
                        agent.hasSystemPrompt ? "text-green-500" : "text-red-500"
                      }`}
                    >
                      {agent.hasSystemPrompt ? "Промпт" : "Нет промпта"}
                    </span>
                    <span
                      className={`${
                        agent.hasRules ? "text-green-500" : "text-red-500"
                      }`}
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
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
