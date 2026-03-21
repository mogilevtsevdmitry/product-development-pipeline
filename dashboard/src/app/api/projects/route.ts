import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { listProjects, createProject } from "@/lib/state";

export async function GET() {
  const projects = listProjects();
  return NextResponse.json(projects);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, description, mode, project_path } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Название проекта обязательно" },
        { status: 400 }
      );
    }

    // Validate project_path if provided
    let validatedPath: string | undefined;
    if (project_path && typeof project_path === "string" && project_path.trim().length > 0) {
      validatedPath = project_path.trim();
      if (!path.isAbsolute(validatedPath)) {
        return NextResponse.json(
          { error: "Путь к проекту должен быть абсолютным" },
          { status: 400 }
        );
      }
    }

    const state = createProject(
      name.trim(),
      (description || "").trim(),
      mode === "human_approval" ? "human_approval" : "auto",
      validatedPath
    );

    return NextResponse.json(state, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
