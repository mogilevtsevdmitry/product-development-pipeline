"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import MarkdownEditor from "@/components/MarkdownEditor";
import { Btn } from "./primitives";

const DEBATE_AGENT_OPTIONS = [
  { id: "product-owner", name: "Product Owner" },
  { id: "business-analyst", name: "Business Analyst" },
  { id: "ux-ui-designer", name: "UX/UI Designer" },
  { id: "system-architect", name: "System Architect" },
  { id: "tech-lead", name: "Tech Lead" },
  { id: "backend-developer", name: "Backend Developer" },
  { id: "frontend-developer", name: "Frontend Developer" },
  { id: "devops-engineer", name: "DevOps Engineer" },
  { id: "qa-engineer", name: "QA Engineer" },
  { id: "security-engineer", name: "Security Engineer" },
  { id: "release-manager", name: "Release Manager" },
  { id: "product-marketer", name: "Product Marketer" },
  { id: "smm-manager", name: "SMM Manager" },
  { id: "content-creator", name: "Content Creator" },
  { id: "customer-support", name: "Customer Support" },
  { id: "data-analyst", name: "Data Analyst" },
];

export function NewProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [mode, setMode] = useState<"auto" | "human_approval">("auto");
  const [path, setPath] = useState("");
  const [type, setType] = useState<"standard" | "debate">("standard");
  const [analyst, setAnalyst] = useState("product-owner");
  const [producer, setProducer] = useState("content-creator");
  const [controller, setController] = useState("qa-engineer");

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, description: desc, mode,
          project_path: path || undefined,
          pipeline_type: type,
          ...(type === "debate" ? { debate_roles: { analyst, producer, controller } } : {}),
        }),
      });
      if (res.ok) {
        const state = await res.json();
        onClose();
        router.push(`/project/${state.project_id}`);
      } else {
        const err = await res.json();
        alert(err.error || "Ошибка создания проекта");
      }
    } catch {
      alert("Ошибка сети");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", backdropFilter: "blur(4px)",
      zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "60px 20px", overflow: "auto",
    }}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          background: "var(--bg-1)", border: "1px solid var(--border-2)",
          borderRadius: 16, padding: 28, maxWidth: 720, width: "100%",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,.6)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Новый проект</h2>
          <button type="button" onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--text-3)", fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-2)", marginBottom: 6 }}>Название *</label>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Например: AI Writing Assistant" required autoFocus
              style={{
                width: "100%", padding: "9px 12px",
                background: "var(--bg-2)", border: "1px solid var(--border-2)",
                borderRadius: 8, color: "var(--text-1)", fontSize: 14, fontFamily: "inherit",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-2)", marginBottom: 6 }}>Описание идеи</label>
            <MarkdownEditor
              value={desc}
              onChange={setDesc}
              placeholder={path
                ? "Опишите текущее состояние проекта и что нужно сделать..."
                : "Опишите идею продукта, целевую аудиторию, проблему..."}
              minRows={5}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-2)", marginBottom: 8 }}>Режим работы</label>
            <div style={{ display: "flex", gap: 10 }}>
              {([
                { v: "auto", t: "🤖 Автоматический", d: "Остановки только на gate-точках" },
                { v: "human_approval", t: "👤 С подтверждением", d: "Пауза после каждого агента" },
              ] as const).map((o) => (
                <button key={o.v} type="button" onClick={() => setMode(o.v)} style={{
                  flex: 1, textAlign: "left", padding: "12px 14px", borderRadius: 10,
                  background: mode === o.v ? "var(--accent-soft)" : "var(--bg-2)",
                  border: `1px solid ${mode === o.v ? "var(--accent-soft-border)" : "var(--border-2)"}`,
                  color: mode === o.v ? "var(--accent-lime)" : "var(--text-2)",
                  cursor: "pointer", fontSize: 13,
                }}>
                  <div style={{ fontWeight: 500, marginBottom: 3 }}>{o.t}</div>
                  <div style={{ fontSize: 11, color: "var(--text-4)" }}>{o.d}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-2)", marginBottom: 8 }}>Тип проекта</label>
            <div style={{ display: "flex", gap: 10 }}>
              {([
                { v: "standard", t: "🏗 Пайплайн", d: "Полный цикл от идеи до релиза" },
                { v: "debate", t: "⚡ Штаб агентов", d: "3 агента спорят, 3 раунда" },
              ] as const).map((o) => (
                <button key={o.v} type="button" onClick={() => setType(o.v)} style={{
                  flex: 1, textAlign: "left", padding: "12px 14px", borderRadius: 10,
                  background: type === o.v ? "var(--accent-soft)" : "var(--bg-2)",
                  border: `1px solid ${type === o.v ? "var(--accent-soft-border)" : "var(--border-2)"}`,
                  color: type === o.v ? "var(--accent-lime)" : "var(--text-2)",
                  cursor: "pointer", fontSize: 13,
                }}>
                  <div style={{ fontWeight: 500, marginBottom: 3 }}>{o.t}</div>
                  <div style={{ fontSize: 11, color: "var(--text-4)" }}>{o.d}</div>
                </button>
              ))}
            </div>
          </div>

          {type === "debate" && (
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-2)", marginBottom: 8 }}>Роли</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {([
                  { role: "analyst", label: "🔭 Аналитик", value: analyst, setter: setAnalyst },
                  { role: "producer", label: "⚒️ Производитель", value: producer, setter: setProducer },
                  { role: "controller", label: "🔍 Контролёр", value: controller, setter: setController },
                ] as const).map(({ role, label, value, setter }) => (
                  <div key={role} style={{ padding: 10, borderRadius: 8, background: "var(--bg-2)", border: "1px solid var(--border-2)" }}>
                    <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>{label}</div>
                    <select value={value} onChange={(e) => setter(e.target.value)} style={{
                      width: "100%", padding: "6px 8px", fontSize: 12,
                      background: "var(--bg-3)", border: "1px solid var(--border-2)",
                      borderRadius: 6, color: "var(--text-1)",
                    }}>
                      {DEBATE_AGENT_OPTIONS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-2)", marginBottom: 6 }}>Путь к проекту (опционально)</label>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{
                flex: 1, padding: "9px 12px",
                background: "var(--bg-2)", border: "1px solid var(--border-2)", borderRadius: 8,
                fontFamily: "var(--font-mono)", fontSize: 12,
                color: path ? "var(--text-1)" : "var(--text-4)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {path ? `📁 ${path}` : "Не выбрано"}
              </div>
              <button type="button" onClick={async () => {
                try {
                  const res = await fetch("/api/pick-folder", { method: "POST" });
                  const data = await res.json();
                  if (data.path) setPath(data.path);
                } catch { alert("Не удалось открыть выбор папки"); }
              }} style={{
                padding: "9px 14px", background: "var(--bg-3)", border: "1px solid var(--border-2)",
                borderRadius: 8, color: "var(--text-2)", fontSize: 13, cursor: "pointer",
              }}>📂 Выбрать</button>
              {path && (
                <button type="button" onClick={() => setPath("")} style={{
                  padding: "9px 12px", background: "transparent", border: "1px solid var(--border-2)",
                  borderRadius: 8, color: "var(--text-3)", cursor: "pointer",
                }}>✕</button>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border-1)" }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Отмена</Btn>
          <Btn variant="primary" type="submit" disabled={creating || !name.trim()}>
            {creating ? "Создание…" : "Создать проект"}
          </Btn>
        </div>
      </form>
    </div>
  );
}
