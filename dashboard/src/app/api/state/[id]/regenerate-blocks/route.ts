import { NextRequest, NextResponse } from "next/server";
import { getProjectState, saveProjectState } from "@/lib/state";
import { generateBlocksForProject } from "@/lib/generateBlocks";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = getProjectState(id);
  if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!state.description?.trim()) {
    return NextResponse.json({ error: "Нет описания проекта — невозможно сгенерировать пайплайн" }, { status: 400 });
  }

  // Reset blocks so generation runs again
  state.blocks = [];
  state.pipeline_graph = { nodes: [], edges: [], parallel_groups: [] };
  state.agents = {};
  state.generation_status = "generating";
  state.generation_error = undefined;
  saveProjectState(id, state);

  setImmediate(() => {
    try {
      generateBlocksForProject(id);
    } catch (err) {
      console.error("Failed to regenerate blocks:", err);
    }
  });

  return NextResponse.json({ ok: true });
}
