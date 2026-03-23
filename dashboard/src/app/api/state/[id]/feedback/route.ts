import { NextRequest, NextResponse } from "next/server";
import { getProjectState, saveProjectState } from "@/lib/state";

/**
 * POST /api/state/[id]/feedback
 *
 * Возврат задачи агенту с описанием проблемы.
 * Используется QA, Security, DevOps для возврата задач разработчикам.
 *
 * Body: {
 *   from_agent: "qa-engineer",
 *   to_agent: "backend-developer",
 *   severity: "high",
 *   description: "SQL injection в endpoint /api/users..."
 * }
 *
 * Действие:
 * 1. Записывает feedback в state обоих агентов
 * 2. Сбрасывает to_agent в "pending" с сохранением артефактов
 * 3. Формирует промпт с описанием проблемы и перезапускает агента
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const state = getProjectState(id);
  if (!state) {
    return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  }

  const body = await req.json();
  const { from_agent, to_agent, severity, description } = body;

  // Validate
  if (!from_agent || !to_agent || !description) {
    return NextResponse.json(
      { error: "Требуются поля: from_agent, to_agent, description" },
      { status: 400 }
    );
  }

  if (!state.agents[from_agent] || !state.agents[to_agent]) {
    return NextResponse.json(
      { error: `Агент ${from_agent} или ${to_agent} не найден` },
      { status: 400 }
    );
  }

  // Allowed feedback routes
  const FEEDBACK_ROUTES: Record<string, string[]> = {
    "qa-engineer": ["backend-developer", "frontend-developer"],
    "security-engineer": ["backend-developer", "frontend-developer", "devops-engineer"],
    "devops-engineer": ["backend-developer", "frontend-developer"],
  };

  const allowedTargets = FEEDBACK_ROUTES[from_agent];
  if (!allowedTargets || !allowedTargets.includes(to_agent)) {
    return NextResponse.json(
      { error: `${from_agent} не может вернуть задачу ${to_agent}` },
      { status: 400 }
    );
  }

  // Create feedback item
  const feedback = {
    from_agent,
    to_agent,
    severity: severity || "medium",
    description,
    created_at: new Date().toISOString(),
    resolved: false,
  };

  // Add to from_agent's sent feedback
  if (!state.agents[from_agent].feedback_sent) {
    state.agents[from_agent].feedback_sent = [];
  }
  state.agents[from_agent].feedback_sent!.push(feedback);

  // Add to to_agent's received feedback
  if (!state.agents[to_agent].feedback_received) {
    state.agents[to_agent].feedback_received = [];
  }
  state.agents[to_agent].feedback_received!.push(feedback);

  // Reset target agent to pending (keep artifacts — agent will fix, not rewrite)
  state.agents[to_agent].status = "pending";
  state.agents[to_agent].error = null;

  // If pipeline was completed or stopped, resume it
  if (state.status === "completed" || state.status === "stopped") {
    state.status = "running";
  }

  state.updated_at = new Date().toISOString();
  saveProjectState(id, state);

  return NextResponse.json({
    success: true,
    feedback,
    message: `Задача возвращена ${to_agent}. Агент получит описание проблемы при следующем запуске.`,
  });
}

/**
 * GET /api/state/[id]/feedback
 *
 * Получить все feedback items для проекта
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const state = getProjectState(id);
  if (!state) {
    return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  }

  const allFeedback: any[] = [];
  for (const [agentId, agent] of Object.entries(state.agents)) {
    for (const fb of agent.feedback_sent || []) {
      allFeedback.push({ ...fb, id: `${agentId}-${fb.created_at}` });
    }
  }

  allFeedback.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return NextResponse.json({ feedback: allFeedback });
}
