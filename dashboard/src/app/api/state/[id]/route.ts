import { NextRequest, NextResponse } from "next/server";
import { getProjectState, resolveGate, switchMode } from "@/lib/state";
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

  // Переключение режима
  if (body.action === "switch_mode" && body.mode) {
    const success = switchMode(id, body.mode as PipelineMode);
    if (!success) {
      return NextResponse.json(
        { error: "Проект не найден" },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  // Gate-решение
  const { gate, decision, notes } = body as {
    gate: string;
    decision: string;
    notes?: string;
  };

  if (!gate || !decision) {
    return NextResponse.json(
      { error: "Необходимы gate и decision" },
      { status: 400 }
    );
  }

  const success = resolveGate(
    id,
    gate as GateType,
    decision as GateDecisionValue,
    notes
  );

  if (!success) {
    return NextResponse.json(
      { error: "Не удалось обновить состояние" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
