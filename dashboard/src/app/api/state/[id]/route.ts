import { NextRequest, NextResponse } from "next/server";
import { getProjectState, resolveGate } from "@/lib/state";
import type { GateType } from "@/lib/types";

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
  const { gate, decision, notes } = body as {
    gate: GateType;
    decision: string;
    notes?: string;
  };

  if (!gate || !decision) {
    return NextResponse.json(
      { error: "Необходимы gate и decision" },
      { status: 400 }
    );
  }

  const success = resolveGate(id, gate, decision, notes);

  if (!success) {
    return NextResponse.json(
      { error: "Не удалось обновить состояние" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
