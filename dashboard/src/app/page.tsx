"use client";

import { useEffect, useState } from "react";
import ProjectCard from "@/components/ProjectCard";

interface ProjectSummary {
  project_id: string;
  project_name: string;
  status: string;
  mode: string;
  created_at: string;
  updated_at: string;
  current_gate?: string | null;
}

export default function HomePage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
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
    load();
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Проекты</h1>
          <p className="text-gray-400 text-sm mt-1">
            Управление продуктовым пайплайном
          </p>
        </div>
        <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors">
          + Новый проект
        </button>
      </div>

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
      ) : projects.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-gray-500">📦</span>
          </div>
          <h2 className="text-lg font-medium text-gray-300 mb-2">
            Нет проектов
          </h2>
          <p className="text-gray-500 text-sm">
            Создайте первый проект, чтобы начать работу с пайплайном
          </p>
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
