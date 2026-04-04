import { NextRequest, NextResponse } from "next/server";
import { getProjectState, saveProjectState } from "@/lib/state";
import { buildAnalystPrompt, buildProducerPrompt, buildControllerPrompt } from "@/lib/debateAgents";
import { spawn } from "child_process";
import type { DebateRound, DebateVerdict } from "@/lib/types";

const ENV_PATH = "/Users/dmitry/.nvm/versions/node/v22.20.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");

    // Write prompt to temp file to avoid shell escaping issues with echo
    const tmpFile = path.join(os.tmpdir(), `debate-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
    fs.writeFileSync(tmpFile, prompt, "utf-8");

    const child = spawn(
      "/bin/sh",
      ["-c", `cat "${tmpFile}" | claude --print --model claude-sonnet-4-6 --dangerously-skip-permissions`],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PATH: ENV_PATH },
      }
    );

    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.on("close", () => {
      try { fs.unlinkSync(tmpFile); } catch {}
      resolve(stdout.trim());
    });
    setTimeout(() => { try { child.kill(); } catch {} resolve(stdout.trim()); }, 120000);
  });
}

function parseVerdict(output: string): DebateVerdict {
  const match = output.match(/РЕШЕНИЕ:\s*(sign-off|issues|blocker)/i);
  if (match) {
    const v = match[1].toLowerCase();
    if (v === "sign-off") return "sign-off";
    if (v === "blocker") return "blocker";
  }
  return "issues";
}

function parseFocus(output: string): string {
  const match = output.match(/ФОКУС:\s*(.+)/);
  return match ? match[1].trim() : "";
}

function parseIssues(output: string): string[] {
  const issues: string[] = [];
  const lines = output.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("🚫") || trimmed.startsWith("⚠️") || trimmed.startsWith("💡")) {
      issues.push(trimmed);
    }
  }
  return issues;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { action } = body;

    const state = getProjectState(id);
    if (!state) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (state.pipeline_type !== "debate" || !state.debate) {
      return NextResponse.json({ error: "Not a debate project" }, { status: 400 });
    }

    if (action === "run_round") {
      if (state.debate.status === "running") {
        return NextResponse.json({ error: "Round already running" }, { status: 409 });
      }
      if (state.debate.status === "completed") {
        return NextResponse.json({ error: "Debate already completed" }, { status: 409 });
      }

      const roundNumber = state.debate.current_round + 1;
      if (roundNumber > state.debate.max_rounds) {
        return NextResponse.json({ error: "Max rounds reached" }, { status: 409 });
      }

      // Initialize round
      state.debate.current_round = roundNumber;
      state.debate.status = "running";
      state.status = "running";  // Update project status too
      const round: DebateRound = { round: roundNumber };
      state.debate.rounds.push(round);

      // Run in background
      setImmediate(() => runDebateRound(id, roundNumber));

      state.updated_at = new Date().toISOString();
      saveProjectState(id, state);

      return NextResponse.json({ status: "running", round: roundNumber });

    } else if (action === "reset") {
      state.debate.current_round = 0;
      state.debate.status = "idle";
      state.debate.current_agent = undefined;
      state.debate.rounds = [];
      state.status = "created";
      // Reset agent statuses
      const roles = state.debate.roles;
      for (const agentId of [roles.analyst, roles.producer, roles.controller]) {
        if (state.agents[agentId]) {
          state.agents[agentId].status = "pending";
          state.agents[agentId].started_at = null;
          state.agents[agentId].completed_at = null;
        }
      }
      state.updated_at = new Date().toISOString();
      saveProjectState(id, state);
      return NextResponse.json({ ok: true });

    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

async function runDebateRound(projectId: string, roundNumber: number) {
  const state = getProjectState(projectId);
  if (!state?.debate) return;

  const task = state.debate.task;
  const roles = state.debate.roles;
  const previousRounds = state.debate.rounds.filter((r) => r.round < roundNumber);
  const currentRoundIdx = state.debate.rounds.findIndex((r) => r.round === roundNumber);

  // Helper: update agent status in blocks
  function setAgentStatus(agentId: string, status: "running" | "completed") {
    if (state?.agents?.[agentId]) {
      state.agents[agentId]!.status = status;
      if (status === "running") state.agents[agentId]!.started_at = new Date().toISOString();
      if (status === "completed") state.agents[agentId]!.completed_at = new Date().toISOString();
    }
  }

  try {
    // === ANALYST ===
    state.debate.current_agent = "analyst";
    setAgentStatus(roles.analyst, "running");
    state.updated_at = new Date().toISOString();
    saveProjectState(projectId, state);

    const analystPrompt = buildAnalystPrompt(task, previousRounds, roundNumber, roles.analyst);
    const analystOutput = await runClaude(analystPrompt);
    const focus = parseFocus(analystOutput);

    state.debate.rounds[currentRoundIdx].analyst = {
      output: analystOutput,
      focus: focus || "Не определён",
      timestamp: new Date().toISOString(),
    };
    setAgentStatus(roles.analyst, "completed");
    state.updated_at = new Date().toISOString();
    saveProjectState(projectId, state);

    // === PRODUCER ===
    state.debate.current_agent = "producer";
    setAgentStatus(roles.producer, "running");
    state.updated_at = new Date().toISOString();
    saveProjectState(projectId, state);

    const producerPrompt = buildProducerPrompt(task, analystOutput, previousRounds, roundNumber, roles.producer);
    const producerOutput = await runClaude(producerPrompt);

    state.debate.rounds[currentRoundIdx].producer = {
      output: producerOutput,
      timestamp: new Date().toISOString(),
    };
    setAgentStatus(roles.producer, "completed");
    state.updated_at = new Date().toISOString();
    saveProjectState(projectId, state);

    // === CONTROLLER ===
    state.debate.current_agent = "controller";
    setAgentStatus(roles.controller, "running");
    state.updated_at = new Date().toISOString();
    saveProjectState(projectId, state);

    const controllerPrompt = buildControllerPrompt(
      task, producerOutput, focus || analystOutput, previousRounds, roundNumber, roles.controller
    );
    const controllerOutput = await runClaude(controllerPrompt);
    const verdict = parseVerdict(controllerOutput);
    const issues = parseIssues(controllerOutput);

    setAgentStatus(roles.controller, "completed");

    state.debate.rounds[currentRoundIdx].controller = {
      output: controllerOutput,
      verdict,
      issues: issues.length > 0 ? issues : undefined,
      timestamp: new Date().toISOString(),
    };

    // Determine next state
    if (verdict === "sign-off" || roundNumber >= state.debate.max_rounds) {
      state.debate.status = "completed";
      state.status = "completed";
    } else if (verdict === "blocker" && roundNumber >= state.debate.max_rounds) {
      state.debate.status = "deadlocked";
      state.status = "failed";
    } else {
      state.debate.status = "idle";
      // Keep project status as "running" — more rounds to go
    }
    state.debate.current_agent = undefined;

  } catch (err) {
    state.debate.status = "idle";
    state.debate.current_agent = undefined;
  }

  state.updated_at = new Date().toISOString();
  saveProjectState(projectId, state);

  // Auto-advance: if enabled and status is idle (more rounds needed), auto-run next round
  if (state.auto_advance && state.debate.status === "idle" && state.debate.current_round < state.debate.max_rounds) {
    setImmediate(() => {
      const freshState = getProjectState(projectId);
      if (!freshState?.debate || freshState.debate.status !== "idle") return;
      const nextRound = freshState.debate.current_round + 1;
      freshState.debate.current_round = nextRound;
      freshState.debate.status = "running";
      freshState.debate.rounds.push({ round: nextRound });
      freshState.updated_at = new Date().toISOString();
      saveProjectState(projectId, freshState);
      runDebateRound(projectId, nextRound);
    });
  }
}
