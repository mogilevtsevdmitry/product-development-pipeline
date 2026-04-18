"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { VProject, VDecision, PHASES } from "@/lib/dashboardModel";
import { StatusPill, Health, Btn, PhaseTag, fmtDate, fmtRelative, fmtCost, fmtTokens } from "./primitives";

function MiniGantt({ project, startAll, endAll }: { project: VProject; startAll: number; endAll: number }) {
  const total = Math.max(1, endAll - startAll);
  const now = Date.now();
  return (
    <div style={{ position: "relative", height: 6, background: "var(--bg-3)", borderRadius: 9999, overflow: "hidden" }}>
      {project.phases.map((ph, i) => {
        const phDef = PHASES.find((p) => p.id === ph.id);
        const left = ((ph.start.getTime() - startAll) / total) * 100;
        const width = ((ph.end.getTime() - ph.start.getTime()) / total) * 100;
        const op = ph.status === "plan" ? 0.3 : 1;
        const color = ph.status === "fail" ? "var(--err)" : ph.status === "gate" ? "var(--warn)" : phDef?.color || "var(--bg-4)";
        return (
          <div key={i} style={{
            position: "absolute", left: `${left}%`, width: `${width}%`, height: "100%",
            background: color, opacity: op, borderRight: "1px solid var(--bg-0)",
          }} />
        );
      })}
      <div style={{
        position: "absolute",
        left: `${((now - startAll) / total) * 100}%`,
        top: -2, bottom: -2, width: 2, background: "var(--accent-lime)",
        boxShadow: "0 0 0 1px var(--bg-0)",
      }} />
    </div>
  );
}

function ProjectListRow({ project, selected, onClick, startAll, endAll }: {
  project: VProject; selected: boolean; onClick: () => void; startAll: number; endAll: number;
}) {
  return (
    <div onClick={onClick} style={{
      padding: "14px 16px", borderRadius: 10,
      background: selected ? "var(--bg-3)" : "transparent",
      border: `1px solid ${selected ? "var(--border-3)" : "transparent"}`,
      cursor: "pointer", transition: "all .15s",
    }}
    onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "var(--bg-2)"; }}
    onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.name}</span>
        <StatusPill status={project.status} size="sm" />
      </div>
      <MiniGantt project={project} startAll={startAll} endAll={endAll} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: "var(--text-4)", fontFamily: "var(--font-mono)" }}>
        <span>{project.completed}/{project.total}</span>
        <span>ETA {fmtDate(project.eta)}</span>
      </div>
    </div>
  );
}

function GanttTimeline({ project }: { project: VProject }) {
  const starts = project.phases.map((p) => p.start.getTime());
  const ends = project.phases.map((p) => p.end.getTime());
  const startAll = Math.min(...starts);
  const endAll = Math.max(...ends);
  const pad = Math.max(1, (endAll - startAll) * 0.05);
  const rangeStart = startAll - pad;
  const rangeEnd = endAll + pad;
  const total = rangeEnd - rangeStart;

  const dayMs = 86_400_000;
  const days = Math.max(1, Math.ceil(total / dayMs));
  const markerStep = days > 14 ? 3 : days > 7 ? 2 : 1;
  const markers: { date: Date; left: number }[] = [];
  for (let d = 0; d <= days; d += markerStep) {
    const date = new Date(rangeStart + d * dayMs);
    markers.push({ date, left: ((date.getTime() - rangeStart) / total) * 100 });
  }

  const ROW_H = 44;
  const LABEL_W = 140;
  const now = Date.now();

  return (
    <div style={{ background: "var(--bg-1)", border: "1px solid var(--border-1)", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border-1)", background: "var(--bg-2)", height: 40 }}>
        <div style={{ width: LABEL_W, borderRight: "1px solid var(--border-1)", display: "flex", alignItems: "center", padding: "0 16px", fontSize: 11, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".08em" }}>Фаза</div>
        <div style={{ flex: 1, position: "relative" }}>
          {markers.map((m, i) => (
            <div key={i} style={{ position: "absolute", left: `${m.left}%`, top: 0, bottom: 0, display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--text-4)", fontFamily: "var(--font-mono)", transform: "translateX(-50%)" }}>{fmtDate(m.date)}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ position: "relative" }}>
        <div style={{ position: "absolute", left: LABEL_W, right: 0, top: 0, bottom: 0, pointerEvents: "none" }}>
          {markers.map((m, i) => (
            <div key={i} style={{ position: "absolute", left: `${m.left}%`, top: 0, bottom: 0, width: 1, background: "var(--border-1)" }} />
          ))}
          <div style={{
            position: "absolute",
            left: `${((now - rangeStart) / total) * 100}%`,
            top: 0, bottom: 0, width: 2, background: "var(--accent-lime)",
            boxShadow: "0 0 12px rgba(200,255,46,.5)",
          }}>
            <div style={{ position: "absolute", top: -1, left: -4, width: 10, height: 10, borderRadius: 9999, background: "var(--accent-lime)", boxShadow: "0 0 8px var(--accent-lime)" }} />
          </div>
        </div>

        {project.phases.map((ph, i) => {
          const phDef = PHASES.find((p) => p.id === ph.id);
          const left = ((ph.start.getTime() - rangeStart) / total) * 100;
          const width = ((ph.end.getTime() - ph.start.getTime()) / total) * 100;
          const isFail = ph.status === "fail";
          const isGate = ph.status === "gate";
          const isRun = ph.status === "run";
          const isDone = ph.status === "done";
          const isPlan = ph.status === "plan";
          const barColor = isFail ? "var(--err)" : isGate ? "var(--warn)" : phDef?.color || "var(--bg-4)";
          const bg = isPlan ? "transparent" : barColor;
          const border = isPlan ? "1px dashed rgba(255,255,255,.15)" : `1px solid ${barColor}`;
          return (
            <div key={i} style={{ display: "flex", height: ROW_H, borderBottom: i < project.phases.length - 1 ? "1px solid var(--border-1)" : "none" }}>
              <div style={{ width: LABEL_W, borderRight: "1px solid var(--border-1)", display: "flex", alignItems: "center", padding: "0 16px", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: phDef?.color }} />
                <span style={{ fontSize: 13, color: "var(--text-1)" }}>{phDef?.name || ph.id}</span>
              </div>
              <div style={{ flex: 1, position: "relative" }}>
                <div style={{
                  position: "absolute", left: `${left}%`, width: `${width}%`, top: 10, height: ROW_H - 20,
                  background: bg, border, borderRadius: 6,
                  opacity: isPlan ? 0.7 : 1,
                  display: "flex", alignItems: "center", padding: "0 10px", gap: 6,
                  color: isPlan ? "var(--text-3)" : "rgba(0,0,0,.85)",
                  fontSize: 11, fontWeight: 600, overflow: "hidden", whiteSpace: "nowrap",
                }}>
                  {isRun && (
                    <span style={{
                      position: "absolute", inset: 0,
                      background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,.3) 50%, transparent 100%)",
                      backgroundSize: "200% 100%", animation: "shimmer 2s linear infinite",
                    }} />
                  )}
                  {isGate && <span style={{ position: "relative", zIndex: 1 }}>🏗 Gate</span>}
                  {isFail && <span style={{ position: "relative", zIndex: 1 }}>⚠ Блокер</span>}
                  {isRun && <span style={{ position: "relative", zIndex: 1 }}>▶ {ph.id}</span>}
                  {isDone && <span style={{ position: "relative", zIndex: 1 }}>✓</span>}
                  {isPlan && <span style={{ position: "relative", zIndex: 1, opacity: 0.7 }}>{fmtDate(ph.start)}—{fmtDate(ph.end)}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProjectDetail({ project, onOpen }: { project: VProject; onOpen: () => void }) {
  return (
    <div style={{ padding: "24px 32px", overflow: "auto", height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <Health health={project.health} />
            <span style={{ color: "var(--text-4)" }}>·</span>
            <span style={{ fontSize: 12, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>{project.id}</span>
          </div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-.01em" }}>{project.name}</h1>
          <p style={{ margin: "6px 0 0", color: "var(--text-3)", fontSize: 14, maxWidth: 680, whiteSpace: "pre-wrap", maxHeight: 60, overflow: "hidden", textOverflow: "ellipsis" }}>{project.desc}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <Btn variant="secondary" onClick={onOpen}>Открыть проект →</Btn>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { l: "Прогресс", v: `${project.progress}%`, hint: `${project.completed}/${project.total} агентов` },
          { l: "Режим", v: project.mode === "auto" ? "🤖 Авто" : "👤 Ручной", hint: project.mode === "auto" ? "Gate-остановки" : "После каждого" },
          { l: "Запущен", v: fmtDate(project.started), hint: fmtRelative(project.started) },
          { l: "Стоимость", v: fmtCost(project.cost), hint: `${fmtTokens(project.tokens)} токенов` },
          { l: "ETA", v: fmtDate(project.eta), hint: project.status === "completed" ? "завершено" : "через " + Math.max(1, Math.ceil((project.eta.getTime() - Date.now()) / 86400000)) + "д" },
        ].map((s, i) => (
          <div key={i} style={{ background: "var(--bg-1)", border: "1px solid var(--border-1)", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4 }}>{s.l}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text-1)" }}>{s.v}</div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{s.hint}</div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Временная шкала</h2>
        <div style={{ fontSize: 12, color: "var(--text-3)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 2, background: "var(--accent-lime)" }} /> сегодня
          </span>
        </div>
      </div>
      <GanttTimeline project={project} />

      {project.gate && (
        <div style={{ marginTop: 24, padding: 20, border: "1px solid var(--warn-border)", background: "var(--warn-soft)", borderRadius: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 18 }}>🏗</span>
            <h3 style={{ margin: 0, color: "var(--warn)", fontSize: 16, fontWeight: 600 }}>{project.current}</h3>
          </div>
          <p style={{ margin: "0 0 14px", color: "var(--text-2)", fontSize: 13, lineHeight: 1.6 }}>
            Откройте проект, чтобы принять решение по gate-точке.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="primary" onClick={onOpen}>Открыть проект →</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

export function TimelineView({
  projects,
  decisions,
}: {
  projects: VProject[];
  decisions: VDecision[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(projects[0]?.id || null);
  const [filter, setFilter] = useState<"all" | "active" | "blocked">("all");

  const visible = useMemo(() => {
    if (filter === "active") return projects.filter((p) => p.status === "running" || p.status === "gate");
    if (filter === "blocked") return projects.filter((p) => p.health === "blocked");
    return projects;
  }, [projects, filter]);

  const allStarts = projects.flatMap((p) => p.phases.map((ph) => ph.start.getTime()));
  const allEnds = projects.flatMap((p) => p.phases.map((ph) => ph.end.getTime()));
  const startAll = allStarts.length ? Math.min(...allStarts) : Date.now();
  const endAll = allEnds.length ? Math.max(...allEnds) : Date.now() + 86400000;

  const project = projects.find((p) => p.id === selected) || projects[0];
  const open = (id: string) => router.push(`/project/${id}`);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", height: "calc(100vh - 56px)" }}>
      <aside style={{ borderRight: "1px solid var(--border-1)", background: "var(--bg-0)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--border-1)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Проекты</h2>
            <span style={{ fontSize: 11, color: "var(--text-4)", fontFamily: "var(--font-mono)" }}>{projects.length}</span>
          </div>
          <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--bg-2)", borderRadius: 8 }}>
            {([
              { v: "all", l: "Все", c: projects.length },
              { v: "active", l: "Активные", c: projects.filter((p) => p.status === "running" || p.status === "gate").length },
              { v: "blocked", l: "Блокеры", c: projects.filter((p) => p.health === "blocked").length },
            ] as const).map((f) => (
              <button key={f.v} onClick={() => setFilter(f.v)} style={{
                flex: 1, padding: "5px 8px", borderRadius: 6,
                fontSize: 12, fontWeight: 500, border: "none", cursor: "pointer",
                background: filter === f.v ? "var(--bg-4)" : "transparent",
                color: filter === f.v ? "var(--text-1)" : "var(--text-3)",
              }}>{f.l} <span style={{ opacity: 0.6, marginLeft: 3 }}>{f.c}</span></button>
            ))}
          </div>
        </div>

        {decisions.length > 0 && (
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-1)", background: "linear-gradient(180deg, var(--warn-soft), transparent)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--warn)", textTransform: "uppercase", letterSpacing: ".08em" }}>⏳ Ждут решения</span>
              <span style={{ fontSize: 11, color: "var(--text-4)", fontFamily: "var(--font-mono)" }}>{decisions.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {decisions.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setSelected(d.projectId)}
                  style={{
                    textAlign: "left", background: "var(--bg-2)", border: "1px solid var(--warn-border)", borderRadius: 8,
                    padding: "8px 10px", cursor: "pointer", transition: "background .15s", color: "inherit",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.projectName} · {d.waitingFor}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflow: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
          {visible.map((p) => (
            <ProjectListRow key={p.id} project={p} selected={p.id === selected} onClick={() => setSelected(p.id)} startAll={startAll} endAll={endAll} />
          ))}
          {visible.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-4)", fontSize: 13 }}>Нет проектов</div>
          )}
        </div>
      </aside>

      <main style={{ overflow: "hidden", background: "var(--bg-0)" }}>
        {project ? (
          <ProjectDetail project={project} onOpen={() => open(project.id)} />
        ) : (
          <div style={{ padding: 32, color: "var(--text-3)" }}>Выберите проект</div>
        )}
      </main>
    </div>
  );
}
