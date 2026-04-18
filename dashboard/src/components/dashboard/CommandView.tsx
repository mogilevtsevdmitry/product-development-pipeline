"use client";

import { useRouter } from "next/navigation";
import { VProject, VDecision, VActivity } from "@/lib/dashboardModel";
import { StatusPill, STATUS_STYLES, Health, Btn, Avatar, fmtRelative, fmtCost } from "./primitives";

function DecisionCard({ decision, onOpen }: { decision: VDecision; onOpen: () => void }) {
  return (
    <div style={{
      background: "var(--bg-1)", border: "1px solid var(--warn-border)",
      borderRadius: 14, padding: 18, position: "relative", overflow: "hidden",
    }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, var(--warn), transparent)" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: "var(--warn)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".08em", whiteSpace: "nowrap" }}>⏳ Ждёт {decision.waitingFor}</span>
            <span style={{ color: "var(--text-4)" }}>·</span>
            <span style={{ fontSize: 12, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{decision.projectName}</span>
          </div>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{decision.title}</h3>
        </div>
      </div>
      <p style={{ margin: "10px 0 6px", color: "var(--text-2)", fontSize: 13, lineHeight: 1.55 }}>{decision.question}</p>
      <div style={{ background: "var(--bg-2)", border: "1px solid var(--border-1)", borderRadius: 8, padding: "10px 12px", marginBottom: 14, fontSize: 12, color: "var(--text-3)", lineHeight: 1.5 }}>
        <span style={{ fontWeight: 500, color: "var(--text-2)" }}>Саммари:</span> {decision.summary}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Btn variant="primary" onClick={onOpen}>✓ Открыть и решить</Btn>
        <Btn variant="ghost" onClick={onOpen}>Детали →</Btn>
      </div>
    </div>
  );
}

function StuckCard({ project, onOpen }: { project: VProject; onOpen: () => void }) {
  return (
    <div onClick={onOpen} style={{
      background: "var(--bg-1)", border: "1px solid var(--err-border)",
      borderRadius: 12, padding: 14, cursor: "pointer",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: 9999, background: "var(--err)" }} />
        <span style={{ fontSize: 14, fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.name}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--err)", marginBottom: 8 }}>Залип на: {project.current}</div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-4)", fontFamily: "var(--font-mono)" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>{project.id}</span>
        <span>застрял {fmtRelative(project.started)}</span>
      </div>
    </div>
  );
}

function HealthDonut({ projects }: { projects: VProject[] }) {
  const counts: Record<string, number> = { running: 0, gate: 0, completed: 0, failed: 0, pending: 0 };
  projects.forEach((p) => counts[p.status]++);
  const total = projects.length || 1;
  let offset = 0;
  const R = 38, C = 2 * Math.PI * R;
  const segments = [
    { k: "running",   c: "var(--run)" },
    { k: "gate",      c: "var(--warn)" },
    { k: "completed", c: "var(--ok)" },
    { k: "failed",    c: "var(--err)" },
    { k: "pending",   c: "var(--wait)" },
  ];
  return (
    <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
      <svg width={100} height={100} style={{ flexShrink: 0 }}>
        <circle cx={50} cy={50} r={R} fill="none" stroke="var(--bg-3)" strokeWidth={10} />
        {segments.map((s, i) => {
          const frac = counts[s.k] / total;
          const len = frac * C;
          const el = (
            <circle key={i} cx={50} cy={50} r={R} fill="none"
              stroke={s.c} strokeWidth={10}
              strokeDasharray={`${len} ${C}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)" />
          );
          offset += len;
          return el;
        })}
        <text x={50} y={48} textAnchor="middle" fill="var(--text-1)" fontSize={20} fontWeight={700}>{projects.length}</text>
        <text x={50} y={62} textAnchor="middle" fill="var(--text-4)" fontSize={9} style={{ textTransform: "uppercase", letterSpacing: ".1em" }}>проектов</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
        {segments.map((s) => counts[s.k] > 0 && (
          <div key={s.k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.c }} />
            <span style={{ color: "var(--text-2)", flex: 1 }}>{STATUS_STYLES[s.k as keyof typeof STATUS_STYLES].label}</span>
            <span style={{ color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>{counts[s.k]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityFeed({ items }: { items: VActivity[] }) {
  const kindColor: Record<string, string> = {
    run: "var(--run)", done: "var(--ok)", fail: "var(--err)", gate: "var(--warn)", release: "var(--accent-lime)",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: i < items.length - 1 ? "1px solid var(--border-1)" : "none" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 9999, background: kindColor[it.kind] }} />
            {i < items.length - 1 && <span style={{ flex: 1, width: 1, background: "var(--border-1)", marginTop: 4 }} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.text}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, fontSize: 11, color: "var(--text-4)" }}>
              <span style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{it.projName}</span>
              <span>·</span>
              <span>{fmtRelative(it.t)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PortfolioRow({ project, onClick }: { project: VProject; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{
      display: "grid", gridTemplateColumns: "minmax(0,1fr) 120px 110px 60px 18px",
      alignItems: "center", gap: 12, padding: "12px 16px",
      borderBottom: "1px solid var(--border-1)", cursor: "pointer",
      transition: "background .15s",
    }}
    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-2)"; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <div style={{ minWidth: 0, overflow: "hidden" }}>
        <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 3 }}>{project.name}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-4)" }}>
          <Health health={project.health} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>{project.current}</span>
        </div>
      </div>
      <StatusPill status={project.status} size="sm" />
      <div style={{ minWidth: 0 }}>
        <div style={{ height: 4, background: "var(--bg-3)", borderRadius: 9999, overflow: "hidden", marginBottom: 3 }}>
          <div style={{ height: "100%", background: project.health === "blocked" ? "var(--err)" : "var(--accent-lime)", width: `${project.progress}%` }} />
        </div>
        <div style={{ fontSize: 10, color: "var(--text-4)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{project.completed}/{project.total} · {project.progress}%</div>
      </div>
      <span style={{ fontSize: 12, color: "var(--text-2)", fontFamily: "var(--font-mono)", textAlign: "right", whiteSpace: "nowrap" }}>{fmtCost(project.cost)}</span>
      <span style={{ color: "var(--text-4)", textAlign: "right" }}>›</span>
    </div>
  );
}

export function CommandView({
  projects,
  decisions,
  activity,
  onNew,
}: {
  projects: VProject[];
  decisions: VDecision[];
  activity: VActivity[];
  onNew?: () => void;
}) {
  const router = useRouter();
  const open = (id: string) => router.push(`/project/${id}`);
  const blocked = projects.filter((p) => p.health === "blocked");

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 24, gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 4 }}>Добрый день</div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-.01em" }}>Командный центр</h1>
        </div>
        {onNew && <Btn variant="primary" onClick={onNew}>+ Новый проект</Btn>}
      </div>

      {decisions.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 10 }}>
              <span>Нужно ваше решение</span>
              <span style={{
                background: "var(--warn-soft)", color: "var(--warn)",
                border: "1px solid var(--warn-border)", borderRadius: 9999,
                padding: "1px 8px", fontSize: 11, fontWeight: 600,
              }}>{decisions.length}</span>
            </h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 14 }}>
            {decisions.map((d) => <DecisionCard key={d.id} decision={d} onOpen={() => open(d.projectId)} />)}
          </div>
        </section>
      )}

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 32 }}>
        <div style={{ background: "var(--bg-1)", border: "1px solid var(--border-1)", borderRadius: 14, padding: 18 }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 600 }}>Здоровье портфеля</h3>
          <HealthDonut projects={projects} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border-1)" }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 3 }}>Всего агентов</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{projects.reduce((s, p) => s + p.total, 0)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 3 }}>Выполнено</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{projects.reduce((s, p) => s + p.completed, 0)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 3 }}>Ждут gate</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: decisions.length ? "var(--warn)" : "var(--text-1)" }}>{decisions.length}</div>
            </div>
          </div>
        </div>

        <div style={{ background: "var(--bg-1)", border: "1px solid var(--border-1)", borderRadius: 14, padding: 18 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 600 }}>Залипшие проекты</h3>
          {blocked.length === 0 ? (
            <div style={{ padding: "20px 0", color: "var(--text-4)", fontSize: 13, textAlign: "center" }}>Всё под контролем ✓</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {blocked.map((p) => <StuckCard key={p.id} project={p} onOpen={() => open(p.id)} />)}
            </div>
          )}
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20 }}>
        <div style={{ background: "var(--bg-1)", border: "1px solid var(--border-1)", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Все проекты</h3>
            <span style={{ fontSize: 11, color: "var(--text-4)", fontFamily: "var(--font-mono)" }}>{projects.length}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 120px 110px 60px 18px", gap: 12, padding: "8px 16px", borderBottom: "1px solid var(--border-1)", fontSize: 10, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 600 }}>
            <span>Проект</span><span>Статус</span><span>Прогресс</span><span style={{ textAlign: "right" }}>$</span><span></span>
          </div>
          {projects.map((p) => <PortfolioRow key={p.id} project={p} onClick={() => open(p.id)} />)}
          {projects.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-4)", fontSize: 13 }}>Нет проектов</div>
          )}
        </div>
        <div style={{ background: "var(--bg-1)", border: "1px solid var(--border-1)", borderRadius: 14, padding: 18, alignSelf: "start" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>Активность</h3>
          <ActivityFeed items={activity} />
        </div>
      </section>
    </div>
  );
}
