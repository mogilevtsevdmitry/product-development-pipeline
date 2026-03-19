import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const PROJECTS_DIR = path.resolve(process.cwd(), "..", "projects");

/**
 * GET /api/artifact?project=xxx&path=research/problem-researcher/problems.md
 * Returns the raw content of an artifact file.
 */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("project");
  const artifactPath = req.nextUrl.searchParams.get("path");

  if (!projectId || !artifactPath) {
    return NextResponse.json(
      { error: "project and path are required" },
      { status: 400 }
    );
  }

  // Prevent path traversal
  const resolved = path.resolve(PROJECTS_DIR, projectId, artifactPath);
  if (!resolved.startsWith(path.resolve(PROJECTS_DIR))) {
    return NextResponse.json({ error: "Invalid path" }, { status: 403 });
  }

  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const content = fs.readFileSync(resolved, "utf-8");
  return NextResponse.json({ content, path: artifactPath });
}
