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
  const runDir = req.nextUrl.searchParams.get("runDir"); // optional: "quality/qa-engineer/runs/001"

  if (!projectId || !artifactPath) {
    return NextResponse.json(
      { error: "project and path are required" },
      { status: 400 }
    );
  }

  // If runDir specified, look for file in run directory first
  // artifactPath is relative to project (e.g., "quality/qa-engineer/security_report.md")
  // runDir is e.g., "quality/qa-engineer/runs/001"
  // We extract the filename from artifactPath and look in runDir
  let resolved: string;
  if (runDir) {
    const fileName = path.basename(artifactPath);
    resolved = path.resolve(PROJECTS_DIR, projectId, runDir, fileName);
    // Fallback to original path if not in run dir
    if (!fs.existsSync(resolved)) {
      resolved = path.resolve(PROJECTS_DIR, projectId, artifactPath);
    }
  } else {
    resolved = path.resolve(PROJECTS_DIR, projectId, artifactPath);
  }

  // Prevent path traversal
  if (!resolved.startsWith(path.resolve(PROJECTS_DIR))) {
    return NextResponse.json({ error: "Invalid path" }, { status: 403 });
  }

  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const content = fs.readFileSync(resolved, "utf-8");
  return NextResponse.json({ content, path: artifactPath });
}
