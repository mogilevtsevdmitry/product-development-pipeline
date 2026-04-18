"use client";

import React from "react";
import { VStatus, VHealth, PHASES } from "@/lib/dashboardModel";

export const STATUS_STYLES: Record<VStatus, { fg: string; bg: string; bd: string; label: string; pulse?: boolean }> = {
  running:   { fg: "var(--run)",  bg: "var(--run-soft)",  bd: "var(--run-border)",  label: "Выполняется", pulse: true },
  gate:      { fg: "var(--warn)", bg: "var(--warn-soft)", bd: "var(--warn-border)", label: "Ждёт решения" },
  completed: { fg: "var(--ok)",   bg: "var(--ok-soft)",   bd: "var(--ok-border)",   label: "Завершён" },
  failed:    { fg: "var(--err)",  bg: "var(--err-soft)",  bd: "var(--err-border)",  label: "Ошибка" },
  pending:   { fg: "var(--wait)", bg: "var(--wait-soft)", bd: "var(--wait-border)", label: "Не запущен" },
};

export function StatusPill({ status, size = "md", withDot = true }: { status: VStatus; size?: "sm" | "md"; withDot?: boolean }) {
  const s = STATUS_STYLES[status];
  const sm = size === "sm";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: sm ? "2px 8px" : "4px 10px",
      fontSize: sm ? 11 : 12, fontWeight: 500,
      borderRadius: 9999,
      color: s.fg, background: s.bg, border: `1px solid ${s.bd}`,
      whiteSpace: "nowrap",
    }}>
      {withDot && <span className={s.pulse ? "animate-pulse-dot" : ""} style={{ width: sm ? 5 : 6, height: sm ? 5 : 6, borderRadius: 9999, background: s.fg }} />}
      {s.label}
    </span>
  );
}

export function Health({ health }: { health: VHealth }) {
  const map: Record<VHealth, { fg: string; label: string }> = {
    on_track:    { fg: "var(--ok)",     label: "В графике" },
    blocked:     { fg: "var(--err)",    label: "Блокер" },
    not_started: { fg: "var(--text-4)", label: "Не начат" },
  };
  const h = map[health];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: h.fg }}>
      <span style={{ width: 6, height: 6, borderRadius: 9999, background: h.fg }} />
      {h.label}
    </span>
  );
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
export function Btn({
  variant = "primary",
  children,
  style,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  const styles: Record<BtnVariant, React.CSSProperties> = {
    primary:   { background: "var(--accent-lime)",        color: "var(--accent-lime-fg)", border: "1px solid var(--accent-lime)" },
    secondary: { background: "var(--bg-3)",               color: "var(--text-1)",         border: "1px solid var(--border-2)" },
    ghost:     { background: "transparent",               color: "var(--text-2)",         border: "1px solid transparent" },
    danger:    { background: "transparent",               color: "var(--err)",            border: "1px solid var(--err-border)" },
    success:   { background: "var(--ok-soft)",            color: "var(--ok)",             border: "1px solid var(--ok-border)" },
  };
  return (
    <button
      {...rest}
      style={{
        ...styles[variant],
        padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500,
        display: "inline-flex", alignItems: "center", gap: 6,
        transition: "all .15s var(--ease)", whiteSpace: "nowrap", cursor: "pointer",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function PhaseTag({ phase, tiny }: { phase: string; tiny?: boolean }) {
  const ph = PHASES.find((p) => p.id === phase);
  if (!ph) return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: tiny ? 10 : 11, fontWeight: 500,
      color: ph.color,
      padding: tiny ? "1px 6px" : "2px 8px",
      background: "rgba(255,255,255,.04)",
      border: "1px solid rgba(255,255,255,.06)",
      borderRadius: 4,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 9999, background: ph.color }} />
      {ph.name}
    </span>
  );
}

export function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const initials = name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase() || "•";
  const colors = ["#b794f4", "#7aa2ff", "#6ee7b7", "#fbbf24", "#ff7a90", "#5eead4", "#f9a8d4"];
  const hash = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const bg = colors[hash % colors.length];
  return (
    <div title={name} style={{
      width: size, height: size, borderRadius: 9999,
      background: `linear-gradient(135deg, ${bg}, ${bg}cc)`,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.42, fontWeight: 600, color: "rgba(0,0,0,.7)",
      flexShrink: 0,
    }}>{initials}</div>
  );
}

export function fmtDate(d: Date) {
  return d.toLocaleDateString("ru", { day: "numeric", month: "short" });
}
export function fmtRelative(d: Date) {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "сейчас";
  if (diff < 3600) return `${Math.floor(diff / 60)}м назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}ч назад`;
  return `${Math.floor(diff / 86400)}д назад`;
}
export function fmtCost(n: number) {
  return n === 0 ? "—" : "$" + n.toFixed(2);
}
export function fmtTokens(n: number) {
  if (n === 0) return "—";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "K";
  return String(n);
}
