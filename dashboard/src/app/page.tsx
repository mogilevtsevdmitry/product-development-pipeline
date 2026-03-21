"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ProjectCard from "@/components/ProjectCard";
import MarkdownEditor from "@/components/MarkdownEditor";

interface ProjectSummary {
  project_id: string;
  name: string;
  description: string;
  project_path?: string;
  status: string;
  mode: string;
  created_at: string;
  updated_at: string;
  current_gate: string | null;
  agents_total: number;
  agents_completed: number;
}

export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);

  // Form fields
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formMode, setFormMode] = useState<"auto" | "human_approval">("auto");
  const [formProjectPath, setFormProjectPath] = useState("");

  async function loadProjects() {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        setProjects(await res.json());
      }
    } catch (err) {
      console.error("Failed to load projects:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim()) return;

    setCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName,
          description: formDesc,
          mode: formMode,
          project_path: formProjectPath || undefined,
        }),
      });

      if (res.ok) {
        const state = await res.json();
        setShowForm(false);
        setFormName("");
        setFormDesc("");
        setFormMode("auto");
        setFormProjectPath("");
        router.push(`/project/${state.project_id}`);
      } else {
        const err = await res.json();
        alert(err.error || "Ошибка создания проекта");
      }
    } catch (err) {
      alert("Ошибка сети");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Проекты</h1>
          <p className="text-gray-400 text-sm mt-1">
            Управление продуктовым пайплайном
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {showForm ? "Отмена" : "+ Новый проект"}
        </button>
      </div>

      {/* Форма создания проекта */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mb-8 rounded-xl border border-gray-700 bg-gray-900 p-6"
        >
          <h2 className="text-lg font-semibold text-white mb-4">
            Новый проект
          </h2>

          <div className="space-y-4">
            {/* Название */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Название <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Например: AI Writing Assistant"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
                autoFocus
              />
            </div>

            {/* Описание */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Описание идеи
              </label>
              <MarkdownEditor
                value={formDesc}
                onChange={setFormDesc}
                placeholder={formProjectPath
                  ? "Опишите текущее состояние проекта и что нужно сделать:\n\n• Какие задачи выполнить? (тестирование, безопасность, маркетинг...)\n• Что НЕ нужно? (исследование, разработка...)\n• Готовность проекта? (MVP, прототип, готовый продукт)\n\nНенужных агентов можно удалить из пайплайна после создания."
                  : "Опишите идею продукта, целевую аудиторию, проблему...\n\nПоддерживает **Markdown**: заголовки, списки, код.\nПеретащите или вставьте изображение (Ctrl+V)."
                }
                minRows={6}
              />
            </div>

            {/* Режим */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Режим работы
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setFormMode("auto")}
                  className={`flex-1 px-4 py-3 rounded-lg border text-sm text-left transition-colors ${
                    formMode === "auto"
                      ? "border-blue-500 bg-blue-500/10 text-blue-400"
                      : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
                  }`}
                >
                  <div className="font-medium mb-1">🤖 Автоматический</div>
                  <div className="text-xs text-gray-500">
                    Агенты работают автономно, остановки только на gate-точках
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setFormMode("human_approval")}
                  className={`flex-1 px-4 py-3 rounded-lg border text-sm text-left transition-colors ${
                    formMode === "human_approval"
                      ? "border-yellow-500 bg-yellow-500/10 text-yellow-400"
                      : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
                  }`}
                >
                  <div className="font-medium mb-1">👤 С подтверждением</div>
                  <div className="text-xs text-gray-500">
                    Пауза после каждого агента для ревью
                  </div>
                </button>
              </div>
            </div>

            {/* Путь к проекту */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Путь к проекту <span className="text-gray-500">(опционально)</span>
              </label>
              <div className="flex gap-2">
                <div className={`flex-1 px-3 py-2 bg-gray-800 border rounded-lg font-mono text-sm min-h-[38px] flex items-center ${
                  formProjectPath ? "border-blue-500/50 text-white" : "border-gray-700 text-gray-500"
                }`}>
                  {formProjectPath ? (
                    <span className="truncate" title={formProjectPath}>📁 {formProjectPath}</span>
                  ) : (
                    <span>Не выбрано</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await fetch("/api/pick-folder", { method: "POST" });
                      const data = await res.json();
                      if (data.path) {
                        setFormProjectPath(data.path);
                      }
                    } catch {
                      alert("Не удалось открыть выбор папки");
                    }
                  }}
                  className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors whitespace-nowrap"
                >
                  📂 Выбрать
                </button>
                {formProjectPath && (
                  <button
                    type="button"
                    onClick={() => setFormProjectPath("")}
                    className="px-2 py-2 text-gray-500 hover:text-red-400 transition-colors"
                    title="Очистить"
                  >
                    ✕
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Внешняя директория для кода. Разработчики будут писать код в этой папке.
                Если не указан — код создаётся внутри пайплайна.
              </p>
            </div>
          </div>

          {/* Кнопки */}
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-800">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm text-gray-400 hover:text-gray-300 transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={creating || !formName.trim()}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              {creating ? "Создание..." : "Создать проект"}
            </button>
          </div>
        </form>
      )}

      {/* Список проектов */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-gray-800 bg-gray-900 p-5 animate-pulse"
            >
              <div className="h-6 bg-gray-800 rounded w-3/4 mb-4" />
              <div className="h-4 bg-gray-800 rounded w-1/2 mb-2" />
              <div className="h-4 bg-gray-800 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : projects.length === 0 && !showForm ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-gray-500">📦</span>
          </div>
          <h2 className="text-lg font-medium text-gray-300 mb-2">
            Нет проектов
          </h2>
          <p className="text-gray-500 text-sm mb-6">
            Создайте первый проект, чтобы начать работу с пайплайном
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            + Создать проект
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <ProjectCard key={p.project_id} {...p} />
          ))}
        </div>
      )}
    </div>
  );
}
