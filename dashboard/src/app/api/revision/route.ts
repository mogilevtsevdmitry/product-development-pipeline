import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";

const PROJECTS_DIR = path.resolve(process.cwd(), "..", "projects");
const AGENTS_DIR = path.resolve(process.cwd(), "..", "agents");
const STATE_DIR = path.resolve(process.cwd(), "..", "orchestrator", "state");

const AGENT_DIRS: Record<string, string> = {
  "problem-researcher": "research/problem-researcher",
  "market-researcher": "research/market-researcher",
  "product-owner": "product/product-owner",
  "pipeline-architect": "meta/pipeline-architect",
  "business-analyst": "product/business-analyst",
  "legal-compliance": "legal/legal-compliance",
  "ux-ui-designer": "design/ux-ui-designer",
  "system-architect": "development/system-architect",
  "tech-lead": "development/tech-lead",
  "backend-developer": "development/backend-developer",
  "frontend-developer": "development/frontend-developer",
  "devops-engineer": "development/devops-engineer",
  "qa-engineer": "quality/qa-engineer",
  "security-engineer": "quality/security-engineer",
  "release-manager": "release/release-manager",
  "product-marketer": "marketing/product-marketer",
  "smm-manager": "marketing/smm-manager",
  "content-creator": "marketing/content-creator",
  "customer-support": "feedback/customer-support",
  "data-analyst": "feedback/data-analyst",
  orchestrator: "meta/orchestrator",
};

const AGENT_PHASES: Record<string, string> = {
  "problem-researcher": "research",
  "market-researcher": "research",
  "product-owner": "product",
  "pipeline-architect": "meta",
  "business-analyst": "product",
  "legal-compliance": "legal",
  "ux-ui-designer": "design",
  "system-architect": "development",
  "tech-lead": "development",
  "backend-developer": "development",
  "frontend-developer": "development",
  "devops-engineer": "development",
  "qa-engineer": "quality",
  "security-engineer": "quality",
  "release-manager": "release",
  "product-marketer": "marketing",
  "smm-manager": "marketing",
  "content-creator": "marketing",
  "customer-support": "feedback",
  "data-analyst": "feedback",
  orchestrator: "meta",
};

interface RevisionEntry {
  role: "human" | "agent";
  message: string;
  timestamp: string;
}

/**
 * POST /api/revision
 * body: { projectId, agentId, message }
 *
 * 1. Saves human message to revision history
 * 2. Collects agent's current artifacts
 * 3. Sends revision prompt to Claude (non-blocking)
 * 4. Agent response + updated artifacts saved on completion
 */
export async function POST(req: NextRequest) {
  const { projectId, agentId, message } = await req.json();

  if (!projectId || !agentId || !message) {
    return NextResponse.json(
      { error: "projectId, agentId, message required" },
      { status: 400 }
    );
  }

  const phase = AGENT_PHASES[agentId] || "other";
  const agentOutputDir = path.join(PROJECTS_DIR, projectId, phase, agentId);
  const revisionFile = path.join(agentOutputDir, "_revisions.json");

  // Load or create revision history
  let history: RevisionEntry[] = [];
  if (fs.existsSync(revisionFile)) {
    try {
      history = JSON.parse(fs.readFileSync(revisionFile, "utf-8"));
    } catch { /* start fresh */ }
  }

  // Save human message
  history.push({
    role: "human",
    message,
    timestamp: new Date().toISOString(),
  });
  fs.mkdirSync(agentOutputDir, { recursive: true });
  fs.writeFileSync(revisionFile, JSON.stringify(history, null, 2), "utf-8");

  // Mark agent as running in state
  const stateFile = path.join(STATE_DIR, `${projectId}.json`);
  if (fs.existsSync(stateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
      if (state.agents[agentId]) {
        state.agents[agentId].status = "running";
        state.agents[agentId].error = null;
        state.updated_at = new Date().toISOString();
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf-8");
      }
    } catch { /* skip */ }
  }

  // Collect current artifacts content
  const artifactContents: string[] = [];
  if (fs.existsSync(agentOutputDir)) {
    for (const file of fs.readdirSync(agentOutputDir)) {
      if (file.endsWith(".md") && !file.startsWith("_")) {
        const content = fs.readFileSync(path.join(agentOutputDir, file), "utf-8");
        artifactContents.push(`--- Файл: ${file} ---\n${content}\n`);
      }
    }
  }

  // Load agent system prompt
  const agentDir = path.join(AGENTS_DIR, AGENT_DIRS[agentId] || agentId);
  let systemPrompt = "";
  try {
    systemPrompt = fs.readFileSync(path.join(agentDir, "system-prompt.md"), "utf-8");
  } catch { /* skip */ }

  // Build revision prompt
  const revisionPrompt = [
    systemPrompt,
    "\n\n# Контекст\n\nТы уже выполнил эту задачу и создал отчёт. Человек проверил результат и просит внести правки.",
    "\n\n# Твой текущий отчёт\n\n",
    artifactContents.join("\n"),
    "\n\n# Правки от человека\n\n",
    message,
    `\n\n# Инструкции\n\nОбнови свой отчёт с учётом правок. Верни полный обновлённый отчёт в формате Markdown. Весь твой вывод будет сохранён. Не пиши ничего лишнего — только обновлённый структурированный отчёт.`,
  ].join("");

  // Write to temp file
  const tmpFile = path.join(os.tmpdir(), `revision-${agentId}-${Date.now()}.md`);
  fs.writeFileSync(tmpFile, revisionPrompt, "utf-8");

  // Spawn Claude in background
  const child = spawn(
    "/bin/sh",
    ["-c", `cat "${tmpFile}" | claude --print --dangerously-skip-permissions`],
    {
      cwd: agentOutputDir,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

  child.on("close", (code) => {
    try { fs.unlinkSync(tmpFile); } catch { /* */ }

    // Save Claude's output as updated artifact
    if (code === 0 && stdout.trim()) {
      const outputFile = path.join(agentOutputDir, `${agentId}-output.md`);
      fs.writeFileSync(outputFile, stdout.trim(), "utf-8");
    }

    // Save agent response to revision history
    const currentHistory: RevisionEntry[] = fs.existsSync(revisionFile)
      ? JSON.parse(fs.readFileSync(revisionFile, "utf-8"))
      : [];

    currentHistory.push({
      role: "agent",
      message: code === 0
        ? "Правки внесены. Артефакты обновлены."
        : `Ошибка: ${stderr || `код ${code}`}`,
      timestamp: new Date().toISOString(),
    });
    fs.writeFileSync(revisionFile, JSON.stringify(currentHistory, null, 2), "utf-8");

    // Update agent state
    if (fs.existsSync(stateFile)) {
      try {
        const state = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
        if (state.agents[agentId]) {
          state.agents[agentId].status = code === 0 ? "completed" : "failed";
          state.agents[agentId].completed_at = new Date().toISOString();
          state.agents[agentId].error = code === 0 ? null : (stderr || `код ${code}`);

          // Re-collect artifacts
          const artifacts: string[] = [];
          const projectDir = path.join(PROJECTS_DIR, projectId);
          function walk(dir: string) {
            if (!fs.existsSync(dir)) return;
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
              const full = path.join(dir, e.name);
              if (e.isDirectory()) walk(full);
              else if (e.name.endsWith(".md") && !e.name.startsWith("_")) {
                artifacts.push(path.relative(projectDir, full));
              }
            }
          }
          walk(agentOutputDir);
          state.agents[agentId].artifacts = artifacts;
          state.updated_at = new Date().toISOString();
          fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf-8");
        }
      } catch { /* skip */ }
    }
  });

  return NextResponse.json({ ok: true, message: "Ревизия запущена" });
}

/**
 * GET /api/revision?project=xxx&agent=yyy
 * Returns revision history for an agent.
 */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("project");
  const agentId = req.nextUrl.searchParams.get("agent");

  if (!projectId || !agentId) {
    return NextResponse.json(
      { error: "project and agent required" },
      { status: 400 }
    );
  }

  const phase = AGENT_PHASES[agentId] || "other";
  const revisionFile = path.join(
    PROJECTS_DIR, projectId, phase, agentId, "_revisions.json"
  );

  if (!fs.existsSync(revisionFile)) {
    return NextResponse.json([]);
  }

  try {
    const history = JSON.parse(fs.readFileSync(revisionFile, "utf-8"));
    return NextResponse.json(history);
  } catch {
    return NextResponse.json([]);
  }
}
