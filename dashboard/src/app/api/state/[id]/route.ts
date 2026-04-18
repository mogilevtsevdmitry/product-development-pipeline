import { NextRequest, NextResponse } from "next/server";
import {
  getProjectState,
  saveProjectState,
  resolveGate,
  switchMode,
  pauseProject,
  resumeProject,
  stopProject,
  deleteProject,
  runNextAgent,
  startPipeline,
  restartAgent,
  reactivateToGate,
  pauseAgent,
  killAgent,
  runSpecificAgent,
  removeAgentFromPipeline,
  resolveBlockApproval,
  addBlock,
  removeBlock,
  updateBlock,
  reorderBlocks,
  addAgentToBlock,
  removeAgentFromBlock,
  restartCycle,
  updateSchedule,
  updateBlockDeps,
  updateBlockEdges,
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

  if (body.action === "set_auto_advance") {
    const st = getProjectState(id);
    if (!st) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
    st.auto_advance = !!body.enabled;
    st.updated_at = new Date().toISOString();
    saveProjectState(id, st);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "set_full_auto") {
    const st = getProjectState(id);
    if (!st) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
    const enabled = !!body.enabled;
    (st as unknown as { full_auto?: boolean }).full_auto = enabled;
    if (enabled) {
      st.auto_advance = true;
      st.mode = "auto";
    }
    st.updated_at = new Date().toISOString();
    saveProjectState(id, st);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "update_description") {
    const st = getProjectState(id);
    if (!st) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
    st.description = typeof body.description === "string" ? body.description : "";
    st.updated_at = new Date().toISOString();
    saveProjectState(id, st);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "update_project_path") {
    const st = getProjectState(id);
    if (!st) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
    const path = typeof body.project_path === "string" ? body.project_path.trim() : "";
    st.project_path = path || undefined;
    st.updated_at = new Date().toISOString();
    saveProjectState(id, st);
    return NextResponse.json({ ok: true });
  }

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

  if (body.action === "reactivate_gate") {
    const ok = reactivateToGate(id);
    if (!ok) return NextResponse.json({ error: "Нет непройденных gate-точек" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "restart_agent" && body.agentId) {
    const ok = restartAgent(id, body.agentId);
    if (!ok) return NextResponse.json({ error: "Не удалось перезапустить агента" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "pause_agent" && body.agentId) {
    const ok = pauseAgent(id, body.agentId);
    if (!ok) return NextResponse.json({ error: "Агент не запущен" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "kill_agent" && body.agentId) {
    const ok = killAgent(id, body.agentId);
    if (!ok) return NextResponse.json({ error: "Агент не запущен" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "run_agent" && body.agentId) {
    const result = runSpecificAgent(id, body.agentId);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  if (body.action === "remove_agent" && body.agentId) {
    const result = removeAgentFromPipeline(id, body.agentId);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  // --- Block actions ---

  if (body.action === "block_approval" && body.blockId && body.decision) {
    const ok = resolveBlockApproval(id, body.blockId, body.decision, body.notes);
    if (!ok) return NextResponse.json({ error: "Не удалось обработать решение" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "add_block") {
    const ok = addBlock(id, body.name || "Новый блок", body.description, body.requires_approval, body.after_block_id);
    if (!ok) return NextResponse.json({ error: "Не удалось добавить блок" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "remove_block" && body.block_id) {
    const ok = removeBlock(id, body.block_id);
    if (!ok) return NextResponse.json({ error: "Не удалось удалить блок" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "update_block" && body.block_id) {
    const ok = updateBlock(id, body.block_id, {
      name: body.name,
      description: body.description,
      requires_approval: body.requires_approval,
    });
    if (!ok) return NextResponse.json({ error: "Не удалось обновить блок" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "reorder_blocks" && body.block_ids) {
    const ok = reorderBlocks(id, body.block_ids);
    if (!ok) return NextResponse.json({ error: "Не удалось изменить порядок блоков" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "add_agent_to_block" && body.block_id && body.agent_id) {
    const ok = addAgentToBlock(id, body.block_id, body.agent_id);
    if (!ok) return NextResponse.json({ error: "Не удалось добавить агента в блок" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "remove_agent_from_block" && body.block_id && body.agent_id) {
    const ok = removeAgentFromBlock(id, body.block_id, body.agent_id);
    if (!ok) return NextResponse.json({ error: "Не удалось удалить агента из блока" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "restart_cycle") {
    const ok = restartCycle(id);
    if (!ok) return NextResponse.json({ error: "Не удалось перезапустить цикл" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "update_schedule" && body.schedule) {
    const ok = updateSchedule(id, body.schedule);
    if (!ok) return NextResponse.json({ error: "Не удалось обновить расписание" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "update_block_edges" && body.block_id && body.edges) {
    const ok = updateBlockEdges(id, body.block_id, body.edges);
    if (!ok) return NextResponse.json({ error: "Не удалось обновить связи агентов" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "update_block_deps" && body.block_id && body.depends_on) {
    const ok = updateBlockDeps(id, body.block_id, body.depends_on);
    if (!ok) return NextResponse.json({ error: "Не удалось обновить зависимости" }, { status: 400 });
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
