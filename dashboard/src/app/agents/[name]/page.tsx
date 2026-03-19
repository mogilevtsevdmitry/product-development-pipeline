"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface Skill {
  name: string;
  content: string;
}

interface AgentData {
  id: string;
  phase: string;
  systemPrompt: string;
  rules: string;
  skills: Skill[];
}

type TabType = "prompt" | "rules" | "skills";

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

export default function AgentEditPage() {
  const params = useParams();
  const name = params.name as string;

  const [agent, setAgent] = useState<AgentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>("prompt");
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [editingSkill, setEditingSkill] = useState<string | null>(null);
  const [newSkillName, setNewSkillName] = useState("");
  const [showNewSkill, setShowNewSkill] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(() => {
    fetch(`/api/agents/${name}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) setAgent(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    // Also load enabled status
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d) => {
        const found = (d.agents || []).find((a: { id: string }) => a.id === name);
        if (found) setEnabled(found.enabled);
      })
      .catch(() => {});
  }, [name]);

  useEffect(() => {
    load();
  }, [load]);

  const currentContent = () => {
    if (!agent) return "";
    if (activeTab === "prompt") return agent.systemPrompt;
    if (activeTab === "rules") return agent.rules;
    return "";
  };

  const startEditing = (content?: string) => {
    setEditContent(content ?? currentContent());
    setEditing(true);
    setSaveStatus(null);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(0, 0);
      }
    }, 50);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditContent("");
    setEditingSkill(null);
    setSaveStatus(null);
  };

  const save = async () => {
    if (!agent) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      let body: Record<string, string>;
      if (editingSkill) {
        body = { file: "skill", content: editContent, skillName: editingSkill };
      } else if (activeTab === "prompt") {
        body = { file: "system-prompt", content: editContent };
      } else {
        body = { file: "rules", content: editContent };
      }

      const res = await fetch(`/api/agents/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setSaveStatus("saved");
        setEditing(false);
        setEditingSkill(null);
        load();
      } else {
        setSaveStatus("error");
      }
    } catch {
      setSaveStatus("error");
    }
    setSaving(false);
  };

  const handleFileUpload = (target: "system-prompt" | "rules" | "skill") => {
    const input = fileInputRef.current;
    if (!input) return;
    input.dataset.target = target;
    input.click();
  };

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const target = (e.target as HTMLInputElement).dataset.target as string;
    const content = await file.text();

    if (target === "skill") {
      const skillName = file.name.replace(/\.md$/, "");
      setEditingSkill(skillName);
      setEditContent(content);
      setEditing(true);
      setActiveTab("skills");
    } else {
      if (target === "prompt") setActiveTab("prompt");
      else setActiveTab("rules");
      startEditing(content);
    }

    e.target.value = "";
  };

  const createSkill = () => {
    if (!newSkillName.trim()) return;
    setEditingSkill(newSkillName.trim());
    setEditContent(`# ${newSkillName.trim()}\n\nОписание скилла...\n`);
    setEditing(true);
    setShowNewSkill(false);
    setNewSkillName("");
  };

  const editSkill = (skill: Skill) => {
    setEditingSkill(skill.name.replace(/\.md$/, ""));
    setEditContent(skill.content);
    setEditing(true);
  };

  const deleteSkill = async (skillName: string) => {
    if (!confirm(`Удалить скилл "${skillName}"?`)) return;
    await fetch(`/api/agents/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: "delete-skill", skillName }),
    });
    load();
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-gray-800 rounded" />
          <div className="h-96 bg-gray-800 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <p className="text-red-400">Агент &quot;{name}&quot; не найден</p>
      </div>
    );
  }

  // Parse agent name from frontmatter
  const nameMatch = agent.systemPrompt.match(/^name:\s*(.+)$/m);
  const displayName = nameMatch ? nameMatch[1].trim() : name;
  const roleMatch = agent.systemPrompt.match(/^role:\s*(.+)$/m);
  const role = roleMatch ? roleMatch[1].trim() : "";

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.txt,.markdown"
        className="hidden"
        onChange={onFileSelected}
      />

      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-4">
        <Link href="/agents" className="hover:text-white transition-colors">
          Агенты
        </Link>
        <span>/</span>
        <span className="text-white">{displayName}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{displayName}</h1>
            {!enabled && (
              <span className="text-xs bg-gray-700 text-gray-400 px-2 py-1 rounded">
                Отключён
              </span>
            )}
          </div>
          {role && <p className="text-gray-400 mt-1">{role}</p>}
          <p className="text-sm text-gray-500 mt-1">
            Фаза: {PHASE_LABELS[agent.phase] || agent.phase} &bull;{" "}
            {agent.skills.length} скилл{agent.skills.length !== 1 ? "ов" : ""}
          </p>
        </div>
        <button
          onClick={async () => {
            const newVal = !enabled;
            await fetch("/api/agents", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "toggle",
                agentId: name,
                enabled: newVal,
              }),
            });
            setEnabled(newVal);
          }}
          className={`px-4 py-2 text-sm rounded-lg transition-colors ${
            enabled
              ? "bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30"
              : "bg-green-600/20 text-green-400 hover:bg-green-600/30"
          }`}
        >
          {enabled ? "Отключить" : "Включить"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-gray-800">
        {([
          { key: "prompt" as const, label: "Системный промпт" },
          { key: "rules" as const, label: "Правила" },
          { key: "skills" as const, label: `Скиллы (${agent.skills.length})` },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => {
              setActiveTab(key);
              cancelEditing();
            }}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === key
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === "skills" ? (
        <div className="space-y-4">
          {/* Skills list */}
          {agent.skills.map((skill) => (
            <div
              key={skill.name}
              className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">{skill.name}</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => editSkill(skill)}
                    className="text-sm text-blue-400 hover:text-blue-300"
                  >
                    Редактировать
                  </button>
                  <button
                    onClick={() => deleteSkill(skill.name)}
                    className="text-sm text-red-400 hover:text-red-300"
                  >
                    Удалить
                  </button>
                </div>
              </div>
              <div className="prose prose-invert prose-sm max-w-none">
                <pre className="text-sm text-gray-300 whitespace-pre-wrap bg-gray-900/50 rounded-lg p-4 max-h-60 overflow-y-auto">
                  {skill.content}
                </pre>
              </div>
            </div>
          ))}

          {agent.skills.length === 0 && !showNewSkill && !editing && (
            <div className="text-center py-12 text-gray-500">
              <p className="mb-4">Скиллов пока нет</p>
            </div>
          )}

          {/* New skill form */}
          {showNewSkill && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={newSkillName}
                  onChange={(e) => setNewSkillName(e.target.value)}
                  placeholder="Название скилла..."
                  className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onKeyDown={(e) => e.key === "Enter" && createSkill()}
                  autoFocus
                />
                <button
                  onClick={createSkill}
                  className="px-4 py-2 bg-blue-600 text-sm rounded-lg hover:bg-blue-500"
                >
                  Создать
                </button>
                <button
                  onClick={() => {
                    setShowNewSkill(false);
                    setNewSkillName("");
                  }}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-white"
                >
                  Отмена
                </button>
              </div>
            </div>
          )}

          {/* Add buttons */}
          {!editing && !showNewSkill && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowNewSkill(true)}
                className="px-4 py-2 bg-blue-600 text-sm rounded-lg hover:bg-blue-500"
              >
                + Новый скилл
              </button>
              <button
                onClick={() => handleFileUpload("skill")}
                className="px-4 py-2 bg-gray-700 text-sm rounded-lg hover:bg-gray-600"
              >
                Загрузить файл
              </button>
            </div>
          )}

          {/* Editing skill */}
          {editing && editingSkill && (
            <div className="bg-gray-800/50 border border-blue-500/30 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-blue-400">
                  Редактирование: {editingSkill}
                </h3>
              </div>
              <textarea
                ref={textareaRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full h-96 bg-gray-900 border border-gray-700 rounded-lg p-4 text-sm font-mono text-gray-200 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={save}
                  disabled={saving}
                  className="px-4 py-2 bg-green-600 text-sm rounded-lg hover:bg-green-500 disabled:opacity-50"
                >
                  {saving ? "Сохранение..." : "Сохранить"}
                </button>
                <button
                  onClick={cancelEditing}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-white"
                >
                  Отмена
                </button>
                {saveStatus === "saved" && (
                  <span className="text-sm text-green-400">Сохранено</span>
                )}
                {saveStatus === "error" && (
                  <span className="text-sm text-red-400">Ошибка сохранения</span>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Prompt / Rules tab */
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl">
          {/* Toolbar */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700/50">
            <span className="text-sm text-gray-400">
              {activeTab === "prompt" ? "system-prompt.md" : "rules.md"}
            </span>
            <div className="flex items-center gap-2">
              {!editing && (
                <>
                  <button
                    onClick={() => handleFileUpload(activeTab === "prompt" ? "system-prompt" : "rules")}
                    className="px-3 py-1.5 text-xs bg-gray-700 rounded-lg hover:bg-gray-600"
                  >
                    Загрузить файл
                  </button>
                  <button
                    onClick={() => startEditing()}
                    className="px-3 py-1.5 text-xs bg-blue-600 rounded-lg hover:bg-blue-500"
                  >
                    Редактировать
                  </button>
                </>
              )}
            </div>
          </div>

          {editing ? (
            <div className="p-5">
              <textarea
                ref={textareaRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-4 text-sm font-mono text-gray-200 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
                style={{ minHeight: "500px" }}
              />
              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={save}
                  disabled={saving}
                  className="px-4 py-2 bg-green-600 text-sm rounded-lg hover:bg-green-500 disabled:opacity-50"
                >
                  {saving ? "Сохранение..." : "Сохранить"}
                </button>
                <button
                  onClick={cancelEditing}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-white"
                >
                  Отмена
                </button>
                {saveStatus === "saved" && (
                  <span className="text-sm text-green-400">Сохранено</span>
                )}
                {saveStatus === "error" && (
                  <span className="text-sm text-red-400">Ошибка</span>
                )}
              </div>
            </div>
          ) : (
            <div className="p-5">
              {currentContent() ? (
                <pre className="text-sm text-gray-200 whitespace-pre-wrap font-mono leading-relaxed">
                  {currentContent()}
                </pre>
              ) : (
                <p className="text-gray-500 text-center py-12">
                  Файл пуст. Нажмите &quot;Редактировать&quot; или загрузите файл.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
