"use client";

import Link from "next/link";
import { Avatar } from "./primitives";

export type Variation = "timeline" | "command";

export function TopHeader({
  variation,
  setVariation,
  onNew,
}: {
  variation: Variation;
  setVariation: (v: Variation) => void;
  onNew?: () => void;
}) {
  return (
    <header style={{
      height: 56, borderBottom: "1px solid var(--border-1)",
      background: "rgba(10,10,15,.85)", backdropFilter: "blur(10px)",
      WebkitBackdropFilter: "blur(10px)",
      position: "sticky", top: 0, zIndex: 40,
      display: "flex", alignItems: "center", padding: "0 24px", gap: 24,
    }}>
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit" }}>
        <div style={{
          width: 28, height: 28, borderRadius: 7,
          background: "var(--accent-lime)", color: "var(--accent-lime-fg)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, fontWeight: 700, letterSpacing: "-.02em",
        }}>PP</div>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Product Pipeline</span>
      </Link>

      <nav style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--text-3)" }}>
        <Link href="/" style={{ color: "var(--text-2)", textDecoration: "none" }}>Проекты</Link>
        <Link href="/agents" style={{ color: "var(--text-3)", textDecoration: "none" }}>Агенты</Link>
      </nav>

      <div style={{
        display: "flex", background: "var(--bg-2)", border: "1px solid var(--border-1)",
        borderRadius: 10, padding: 3, marginLeft: "auto",
      }}>
        {([
          { v: "timeline", label: "A · Timeline" },
          { v: "command",  label: "B · Command" },
        ] as const).map((o) => (
          <button
            key={o.v}
            onClick={() => setVariation(o.v)}
            style={{
              padding: "5px 12px", fontSize: 12, fontWeight: 500, borderRadius: 7,
              background: variation === o.v ? "var(--bg-4)" : "transparent",
              color: variation === o.v ? "var(--text-1)" : "var(--text-3)",
              border: "none", transition: "all .15s", cursor: "pointer",
              boxShadow: variation === o.v ? "0 1px 2px rgba(0,0,0,.3)" : "none",
            }}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {onNew && (
          <button
            onClick={onNew}
            style={{
              background: "var(--accent-lime)", color: "var(--accent-lime-fg)",
              border: "none", borderRadius: 8, padding: "7px 14px",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
            }}
          >
            + Новый проект
          </button>
        )}
        <Avatar name="PP User" size={28} />
      </div>
    </header>
  );
}
