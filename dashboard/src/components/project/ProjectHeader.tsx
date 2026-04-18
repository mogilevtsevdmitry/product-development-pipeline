"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import type { ProjectState, ProjectStatus } from "@/lib/types";

interface Props {
  state: ProjectState;
  completed: number;
  total: number;
  tokens: number;
  cost: number;
  actionLoading: string | null;
  onAction: (action: string, extra?: Record<string, unknown>, method?: "POST" | "DELETE") => void;
}

function Chip({
  active,
  onClick,
  disabled,
  children,
  tone = "neutral",
}: {
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  tone?: "neutral" | "lime" | "indigo" | "warn" | "danger" | "ok";
}) {
  const toneStyles: Record<string, React.CSSProperties> = {
    neutral: active
      ? { background: "var(--bg-3)", color: "var(--text-1)", borderColor: "var(--border-3)" }
      : { background: "var(--bg-2)", color: "var(--text-2)", borderColor: "var(--border-1)" },
    lime: {
      background: "var(--accent-lime)",
      color: "var(--accent-lime-fg)",
      borderColor: "var(--accent-lime)",
    },
    indigo: {
      background: "var(--accent-project)",
      color: "var(--text-1)",
      borderColor: "var(--accent-project)",
    },
    warn: {
      background: "var(--warn-soft)",
      color: "var(--warn)",
      borderColor: "var(--warn-border)",
    },
    danger: {
      background: "var(--destructive-soft)",
      color: "var(--destructive)",
      borderColor: "var(--destructive-border)",
    },
    ok: {
      background: "var(--ok-soft)",
      color: "var(--ok)",
      borderColor: "var(--ok-border)",
    },
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...toneStyles[tone],
        padding: "6px 12px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 500,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: "1px solid",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "all .15s var(--ease)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function InlineEdit({
  value,
  placeholder,
  mono,
  onSave,
  pickable,
  multiline,
  maxWidth,
}: {
  value: string;
  placeholder: string;
  mono?: boolean;
  onSave: (v: string) => void;
  pickable?: boolean;
  multiline?: boolean;
  maxWidth?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => setDraft(value), [value]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  async function pick() {
    try {
      const res = await fetch("/api/pick-folder", { method: "POST" });
      const data = await res.json();
      if (data.path) {
        setDraft(data.path);
        onSave(data.path);
      }
    } catch {}
  }

  const commit = () => {
    if (draft.trim() !== value.trim()) onSave(draft.trim());
    setEditing(false);
  };
  const cancel = () => { setDraft(value); setEditing(false); };

  if (editing) {
    const commonStyle: React.CSSProperties = {
      flex: 1,
      minWidth: 0,
      padding: "3px 8px",
      background: "var(--bg-2)",
      border: "1px solid var(--accent-project-border)",
      borderRadius: 6,
      color: "var(--text-1)",
      fontSize: 12,
      fontFamily: mono ? "var(--font-mono)" : "inherit",
      maxWidth,
    };
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: multiline ? "1 1 auto" : undefined }}>
        {multiline ? (
          <textarea
            ref={ref as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); } if (e.key === "Escape") cancel(); }}
            style={{ ...commonStyle, minHeight: 60, resize: "vertical" }}
          />
        ) : (
          <input
            ref={ref as React.RefObject<HTMLInputElement>}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
            style={commonStyle}
          />
        )}
        {pickable && (
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={pick} style={{
            padding: "3px 8px", background: "var(--bg-3)", border: "1px solid var(--border-2)",
            borderRadius: 6, color: "var(--text-2)", fontSize: 11, cursor: "pointer",
          }}>📂</button>
        )}
      </span>
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        cursor: "pointer",
        color: value ? "var(--text-2)" : "var(--text-4)",
        fontFamily: mono ? "var(--font-mono)" : "inherit",
        fontSize: 12,
        maxWidth: maxWidth || undefined,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        padding: "2px 0",
        borderBottom: "1px dashed transparent",
        transition: "all .15s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderBottomColor = "var(--border-2)"; e.currentTarget.style.color = "var(--text-1)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderBottomColor = "transparent"; e.currentTarget.style.color = value ? "var(--text-2)" : "var(--text-4)"; }}
      title={value || placeholder}
    >
      {mono && value ? "📁 " : ""}{value || placeholder}
      <span style={{ color: "var(--text-4)", fontSize: 10, marginLeft: 2 }}>✎</span>
    </span>
  );
}

function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function ProjectHeader({ state, completed, total, tokens, cost, actionLoading, onAction }: Props) {
  const [showDelete, setShowDelete] = useState(false);
  const isDebate = state.pipeline_type === "debate";
  const fullAuto = state.full_auto === true;
  const autopilot = state.auto_advance === true;
  const scheduleOn = state.schedule?.enabled === true;

  return (
    <>
      {/* Row 1 — primary actions */}
      <header style={{
        background: "var(--bg-0)", borderBottom: "1px solid var(--border-1)",
        padding: "10px 20px", display: "flex", alignItems: "center", gap: 12,
        flexWrap: "wrap", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          <Link href="/" style={{
            color: "var(--text-3)", fontSize: 13, textDecoration: "none",
            display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
          }}>← Проекты</Link>
          <span style={{ color: "var(--text-4)" }}>/</span>
          <h1 style={{
            margin: 0, fontSize: 16, fontWeight: 600, color: "var(--text-1)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
          }}>{state.name}</h1>
          <StatusBadge status={state.status as ProjectStatus} />
          {state.current_cycle > 1 && (
            <span style={{
              fontSize: 11, color: "var(--accent-project)",
              background: "var(--accent-project-soft)", padding: "2px 8px",
              borderRadius: 9999, fontWeight: 500,
            }}>Цикл #{state.current_cycle}</span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--text-3)", marginRight: 4, fontFamily: "var(--font-mono)" }}>
            {completed}/{total} агентов
          </span>

          {!isDebate && state.status === "created" && (
            <Chip tone="lime" onClick={() => onAction("start_pipeline")} disabled={!!actionLoading}>🚀 Запустить</Chip>
          )}

          {!isDebate && (state.status === "running" || state.status === "paused") && (
            <Chip tone="lime" onClick={() => onAction("run_next")} disabled={!!actionLoading}>▶ Следующий</Chip>
          )}

          {!isDebate && (state.status === "paused" || state.status === "paused_at_gate" || state.status === "stopped" || state.status === "failed" || state.status === "completed") && (
            <Chip tone="lime" onClick={() => onAction("resume")} disabled={!!actionLoading}>▶ Возобновить</Chip>
          )}

          {!isDebate && state.status === "running" && (
            <Chip tone="warn" onClick={() => onAction("pause")} disabled={!!actionLoading}>⏸ Пауза</Chip>
          )}

          {!isDebate && (state.status === "completed" || state.status === "failed" || state.status === "running" || state.status === "paused") && (
            <Chip tone="neutral" onClick={() => onAction("restart_cycle")} disabled={!!actionLoading}>🔄 Новый цикл</Chip>
          )}

          <Chip tone="neutral" onClick={() => onAction("switch_mode", { mode: state.mode === "auto" ? "human_approval" : "auto" })} disabled={!!actionLoading}>
            {state.mode === "auto" ? "👤 Ручной" : "🤖 Авто"}
          </Chip>

          <Chip
            tone={autopilot ? "lime" : "neutral"}
            active={autopilot}
            onClick={() => onAction("set_auto_advance", { enabled: !autopilot })}
            disabled={!!actionLoading}
          >
            🤖 Автопилот
          </Chip>

          <Chip
            tone={fullAuto ? "indigo" : "neutral"}
            active={fullAuto}
            onClick={() => onAction("set_full_auto", { enabled: !fullAuto })}
            disabled={!!actionLoading}
            title="Агенты идут сквозь все блоки, gate-точки утверждаются автоматически"
          >
            🚀 Полный автомат
          </Chip>

          <Chip
            tone={scheduleOn ? "indigo" : "neutral"}
            active={scheduleOn}
            onClick={() => {
              const current = state.schedule || { preset: "daily", enabled: false };
              onAction("update_schedule", { schedule: { ...current, enabled: !current.enabled } });
            }}
            disabled={!!actionLoading}
          >
            {scheduleOn
              ? `⏰ ${state.schedule?.preset === "daily" ? "Ежедневно" : state.schedule?.preset === "weekly" ? "Еженедельно" : state.schedule?.preset === "hourly" ? "Ежечасно" : state.schedule?.cron || "По расписанию"}`
              : "📅 Расписание"}
          </Chip>

          {!showDelete ? (
            <button
              onClick={() => setShowDelete(true)}
              style={{
                padding: "6px 10px", borderRadius: 8, background: "transparent",
                border: "1px solid transparent", color: "var(--text-3)",
                fontSize: 14, cursor: "pointer", transition: "all .15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--destructive)"; e.currentTarget.style.background = "var(--destructive-soft)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-3)"; e.currentTarget.style.background = "transparent"; }}
              title="Удалить проект"
            >🗑</button>
          ) : (
            <span style={{ display: "inline-flex", gap: 6 }}>
              <Chip tone="danger" onClick={() => onAction("delete", {}, "DELETE")}>Удалить</Chip>
              <Chip tone="neutral" onClick={() => setShowDelete(false)}>Отмена</Chip>
            </span>
          )}
        </div>
      </header>

      {/* Row 2 — info strip with inline-editable description + path */}
      <div style={{
        background: "var(--bg-1)", borderBottom: "1px solid var(--border-1)",
        padding: "8px 20px", display: "flex", alignItems: "center", gap: 20,
        flexShrink: 0, fontSize: 12,
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ color: "var(--text-4)", textTransform: "uppercase", fontSize: 10, letterSpacing: ".08em", fontWeight: 600 }}>Путь</span>
          <InlineEdit
            value={state.project_path || ""}
            placeholder="не задан"
            mono
            pickable
            maxWidth={360}
            onSave={(v) => onAction("update_project_path", { project_path: v })}
          />
        </span>

        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
          <span style={{ color: "var(--text-4)", textTransform: "uppercase", fontSize: 10, letterSpacing: ".08em", fontWeight: 600 }}>Описание</span>
          <InlineEdit
            value={state.description || ""}
            placeholder="добавить описание"
            maxWidth={560}
            multiline
            onSave={(v) => onAction("update_description", { description: v })}
          />
        </span>

        <span style={{ display: "inline-flex", alignItems: "center", gap: 16, flexShrink: 0, marginLeft: "auto" }}>
          <span style={{ color: "var(--text-4)" }}>
            Токены <span style={{ color: "var(--text-1)", fontWeight: 600, fontFamily: "var(--font-mono)" }}>{fmtTokens(tokens)}</span>
          </span>
          <span style={{ color: "var(--text-4)" }}>
            Стоимость <span style={{ color: "var(--text-1)", fontWeight: 600, fontFamily: "var(--font-mono)" }}>${cost.toFixed(2)}</span>
          </span>
        </span>
      </div>
    </>
  );
}
