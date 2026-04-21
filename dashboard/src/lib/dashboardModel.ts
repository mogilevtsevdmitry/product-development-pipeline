export type VStatus = "running" | "gate" | "completed" | "failed" | "pending";
export type VHealth = "on_track" | "blocked" | "not_started";

export interface PhaseBreakdown {
  id: string;
  total: number;
  completed: number;
  running: number;
  failed: number;
  pending: number;
}

export interface ProjectSummary {
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
  phase_breakdown?: PhaseBreakdown[];
}

export interface VProject {
  id: string;
  name: string;
  desc: string;
  status: VStatus;
  health: VHealth;
  mode: "auto" | "human_approval";
  owner: string;
  cost: number;
  tokens: number;
  started: Date;
  eta: Date;
  progress: number;
  completed: number;
  total: number;
  current: string;
  gate: string | null;
  phases: VPhase[];
}

export interface VPhase {
  id: string;
  start: Date;
  end: Date;
  status: "done" | "run" | "plan" | "gate" | "fail";
}

const GATE_LABELS: Record<string, string> = {
  gate_1_build: "Gate 1 — Строим?",
  gate_2_architecture: "Gate 2 — Архитектура",
  gate_3_go_nogo: "Gate 3 — Go / No-go",
};

function mapStatus(raw: string, gate: string | null): VStatus {
  if (gate) return "gate";
  if (raw === "completed") return "completed";
  if (raw === "failed" || raw === "error") return "failed";
  if (raw === "running" || raw === "in_progress") return "running";
  if (raw === "paused_at_gate") return "gate";
  return "pending";
}

function mapHealth(s: VStatus, completed: number): VHealth {
  if (s === "failed") return "blocked";
  if (s === "pending" && completed === 0) return "not_started";
  return "on_track";
}

// Реальные фазы из state.agents: только те, у которых есть агенты в графе проекта.
// Длительности — это плановые слоты, рассчитанные пропорционально размеру фазы.
function buildPhasesFromBreakdown(
  breakdown: PhaseBreakdown[],
  started: Date,
  eta: Date,
): VPhase[] {
  if (!breakdown.length) return [];
  const totalAgents = breakdown.reduce((sum, b) => sum + b.total, 0) || breakdown.length;
  const span = Math.max(1, eta.getTime() - started.getTime());
  let cursor = started.getTime();

  return breakdown.map((b) => {
    const share = b.total / totalAgents;
    const dur = span * share;
    const s = new Date(cursor);
    cursor += dur;
    const e = new Date(cursor);

    let status: VPhase["status"] = "plan";
    if (b.failed > 0) status = "fail";
    else if (b.total > 0 && b.completed === b.total) status = "done";
    else if (b.running > 0 || (b.completed > 0 && b.completed < b.total)) status = "run";
    return { id: b.id, start: s, end: e, status };
  });
}

export function mapProject(p: ProjectSummary): VProject {
  const started = new Date(p.created_at);
  const updated = new Date(p.updated_at);
  const progress = p.agents_total > 0 ? Math.round((p.agents_completed / p.agents_total) * 100) : 0;
  const status = mapStatus(p.status, p.current_gate);
  const health = mapHealth(status, p.agents_completed);
  // ETA: if completed use updated, else project forward proportionally
  const elapsed = updated.getTime() - started.getTime();
  const eta = status === "completed"
    ? updated
    : new Date(started.getTime() + (progress > 0 ? elapsed / (progress / 100) : elapsed * 3));

  let phases = buildPhasesFromBreakdown(p.phase_breakdown || [], started, eta);
  if (p.current_gate) {
    const runIdx = phases.findIndex((ph) => ph.status === "run");
    if (runIdx >= 0) phases[runIdx] = { ...phases[runIdx], status: "gate" };
  }
  if (status === "failed") {
    const runIdx = phases.findIndex((ph) => ph.status === "run");
    if (runIdx >= 0) phases[runIdx] = { ...phases[runIdx], status: "fail" };
  }

  const current = p.current_gate
    ? GATE_LABELS[p.current_gate] || p.current_gate
    : status === "completed"
    ? "Завершён"
    : status === "pending"
    ? "Не запущен"
    : status === "failed"
    ? "Ошибка"
    : `${p.agents_completed} / ${p.agents_total}`;

  return {
    id: p.project_id,
    name: p.name,
    desc: p.description,
    status,
    health,
    mode: p.mode === "human_approval" ? "human_approval" : "auto",
    owner: "—",
    cost: 0,
    tokens: 0,
    started,
    eta,
    progress,
    completed: p.agents_completed,
    total: p.agents_total,
    current,
    gate: p.current_gate,
    phases,
  };
}

export interface VDecision {
  id: string;
  projectId: string;
  projectName: string;
  gate: string;
  title: string;
  question: string;
  waitingFor: string;
  summary: string;
}

const GATE_QUESTIONS: Record<string, string> = {
  gate_1_build: "Проблема реальна, рынок существует, есть смысл инвестировать в разработку?",
  gate_2_architecture: "Архитектура соответствует требованиям, бюджету и срокам?",
  gate_3_go_nogo: "Тесты пройдены, безопасность проверена. Выкатываем?",
};

export function deriveDecisions(list: ProjectSummary[]): VDecision[] {
  return list
    .filter((p) => !!p.current_gate)
    .map((p) => {
      const waitedMs = Date.now() - new Date(p.updated_at).getTime();
      const h = Math.floor(waitedMs / 3600_000);
      const d = Math.floor(h / 24);
      return {
        id: `dec_${p.project_id}`,
        projectId: p.project_id,
        projectName: p.name,
        gate: p.current_gate!,
        title: GATE_LABELS[p.current_gate!] || p.current_gate!,
        question: GATE_QUESTIONS[p.current_gate!] || "Нужно ваше решение",
        waitingFor: d > 0 ? `${d}d ${h % 24}h` : `${h}h`,
        summary: `Прогресс ${p.agents_completed}/${p.agents_total} агентов.`,
      };
    });
}

export interface VActivity {
  t: Date;
  proj: string;
  projName: string;
  text: string;
  kind: "run" | "done" | "fail" | "gate" | "release";
}

export function deriveActivity(list: ProjectSummary[]): VActivity[] {
  return [...list]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 8)
    .map((p) => {
      const s = mapStatus(p.status, p.current_gate);
      let kind: VActivity["kind"] = "run";
      let text = `Обновлён пайплайн — ${p.agents_completed}/${p.agents_total}`;
      if (s === "completed") { kind = "release"; text = "Пайплайн завершён"; }
      else if (s === "failed") { kind = "fail"; text = "Произошла ошибка в пайплайне"; }
      else if (s === "gate") { kind = "gate"; text = `Ожидает решения: ${GATE_LABELS[p.current_gate!] || p.current_gate}`; }
      else if (s === "pending") { kind = "run"; text = "Проект создан"; }
      return {
        t: new Date(p.updated_at),
        proj: p.project_id,
        projName: p.name,
        text,
        kind,
      };
    });
}

export const PHASES = [
  { id: "research", name: "Исследование", color: "var(--ph-research)" },
  { id: "product", name: "Продукт", color: "var(--ph-product)" },
  { id: "legal", name: "Legal", color: "var(--ph-legal)" },
  { id: "design", name: "Дизайн", color: "var(--ph-design)" },
  { id: "development", name: "Разработка", color: "var(--ph-dev)" },
  { id: "content", name: "Контент", color: "var(--ph-marketing)" },
  { id: "quality", name: "Качество", color: "var(--ph-quality)" },
  { id: "release", name: "Релиз", color: "var(--ph-release)" },
  { id: "marketing", name: "Маркетинг", color: "var(--ph-marketing)" },
  { id: "feedback", name: "Фидбэк", color: "var(--ph-feedback)" },
];
