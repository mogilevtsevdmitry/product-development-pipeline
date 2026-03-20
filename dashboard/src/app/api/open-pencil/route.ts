import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const PROJECTS_DIR = path.join(process.cwd(), "..", "projects");

export async function POST(req: NextRequest) {
  const { projectId, filePath } = await req.json();

  if (!projectId || !filePath) {
    return NextResponse.json({ error: "Missing projectId or filePath" }, { status: 400 });
  }

  // Security: only allow .pen files from projects dir
  const fullPath = path.join(PROJECTS_DIR, projectId, filePath);
  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(path.resolve(PROJECTS_DIR)) || !resolved.endsWith(".pen")) {
    return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
  }

  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    // Open the specific .pen file with Pencil app
    spawn("open", [resolved], { detached: true, stdio: "ignore" }).unref();
    return NextResponse.json({ ok: true, path: resolved });
  } catch {
    return NextResponse.json({ error: "Failed to open Pencil" }, { status: 500 });
  }
}
