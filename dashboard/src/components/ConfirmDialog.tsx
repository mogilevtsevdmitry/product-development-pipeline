"use client";

import { useEffect } from "react";

interface Props {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Удалить",
  cancelLabel = "Отмена",
  danger = true,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-1)",
          border: "1px solid var(--border-2)",
          borderRadius: 12,
          padding: "28px 28px 24px",
          minWidth: 420,
          maxWidth: 520,
          boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
        }}
      >
        <h3 style={{ fontSize: 18, fontWeight: 600, color: "var(--text-1)", marginBottom: 12 }}>
          {title}
        </h3>
        {message && (
          <p style={{ fontSize: 14, color: "var(--text-3)", marginBottom: 24, lineHeight: 1.55 }}>
            {message}
          </p>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              background: "var(--bg-3)",
              color: "var(--text-1)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: "var(--border-2)",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              background: danger ? "var(--destructive)" : "var(--accent-lime)",
              color: danger ? "#fff" : "var(--accent-lime-fg)",
              border: "none",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
