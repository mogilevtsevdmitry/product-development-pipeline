import { NextRequest, NextResponse } from "next/server";
import {
  getProjectState,
  resolveGate,
  switchMode,
  pauseProject,
  resumeProject,
  stopProject,
  deleteProject,
  runNextAgent,
  startPipeline,
  restartAgent,
} from "@/lib/state";
import type { GateType, GateDecisionValue, PipelineMode } from "@/lib/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const state = getProjectState(id);

  if (!state) {
    return NextResponse.json(
      { error: "Проект не найден" },
      { status: 404 }
    );
  }

  return NextResponse.json(state);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  // --- Действия над проектом ---

  if (body.action === "switch_mode" && body.mode) {
    const ok = switchMode(id, body.mode as PipelineMode);
    if (!ok) return NextResponse.json({ error: "Не удалось переключить режим" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "pause") {
    const ok = pauseProject(id);
    if (!ok) return NextResponse.json({ error: "Невозможно поставить на паузу" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "resume") {
    const ok = resumeProject(id);
    if (!ok) return NextResponse.json({ error: "Невозможно возобновить" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "stop") {
    const ok = stopProject(id);
    if (!ok) return NextResponse.json({ error: "Невозможно остановить" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "run_next") {
    const result = runNextAgent(id);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  if (body.action === "start_pipeline") {
    const result = startPipeline(id);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  if (body.action === "restart_agent" && body.agentId) {
    const ok = restartAgent(id, body.agentId);
    if (!ok) return NextResponse.json({ error: "Не удалось перезапустить агента" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // --- Gate-решение ---

  const { gate, decision, notes } = body as {
    gate?: string;
    decision?: string;
    notes?: string;
  };

  if (!gate || !decision) {
    return NextResponse.json(
      { error: "Необходимы gate и decision, либо action" },
      { status: 400 }
    );
  }

  const ok = resolveGate(
    id,
    gate as GateType,
    decision as GateDecisionValue,
    notes
  );

  if (!ok) {
    return NextResponse.json(
      { error: "Не удалось обновить состояние" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ok = deleteProject(id);

  if (!ok) {
    return NextResponse.json(
      { error: "Проект не найден" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
