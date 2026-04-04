import { NextRequest, NextResponse } from "next/server";
import { getProjectState, saveProjectState } from "@/lib/state";

/**
 * POST /api/state/[id]/artifact-filters
 * Body: { from: string, to: string, artifacts: string[] | null }
 *
 * Stores artifact filter in state.artifact_filters["from→to"].
 * Also updates pipeline_graph.edges 3rd element if the edge exists.
 * If artifacts is null, removes the filter (back to pass-all).
 * If artifacts is [], passes nothing.
 * If artifacts is ["file.md"], passes only those files.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { from, to, artifacts } = body;

    if (!from || !to) {
      return NextResponse.json({ error: "from and to are required" }, { status: 400 });
    }

    const state = getProjectState(id);
    if (!state) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Initialize artifact_filters if not present
    if (!state.artifact_filters) {
      state.artifact_filters = {};
    }

    const key = `${from}→${to}`;

    if (artifacts === null || artifacts === undefined) {
      // Remove filter (pass all)
      delete state.artifact_filters[key];
    } else {
      state.artifact_filters[key] = artifacts;
    }

    // Also update pipeline_graph.edges if edge exists (for orchestrator compatibility)
    const edgeIndex = state.pipeline_graph.edges.findIndex(
      (e) => e[0] === from && e[1] === to
    );
    if (edgeIndex !== -1) {
      const edge = state.pipeline_graph.edges[edgeIndex];
      if (artifacts === null || artifacts === undefined) {
        state.pipeline_graph.edges[edgeIndex] = [edge[0], edge[1]] as any;
      } else {
        state.pipeline_graph.edges[edgeIndex] = [edge[0], edge[1], artifacts] as any;
      }
    }

    state.updated_at = new Date().toISOString();
    saveProjectState(id, state);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
