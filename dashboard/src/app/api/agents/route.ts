import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const AGENTS_DIR = path.resolve(process.cwd(), "..", "agents");
const CONFIG_PATH = path.join(AGENTS_DIR, "agents-config.json");

interface AgentConfig {
  enabled: boolean;
  phase: string;
  path: string;
  name: string;
  role: string;
  automation_level: string;
}

interface AgentInfo {
  id: string;
  name: string;
  phase: string;
  role: string;
  automationLevel: string;
  enabled: boolean;
  hasSystemPrompt: boolean;
  hasRules: boolean;
  skillsCount: number;
}

function readConfig(): Record<string, AgentConfig> {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

function writeConfig(config: Record<string, AgentConfig>) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export async function GET() {
  const agents: AgentInfo[] = [];
  if (!fs.existsSync(AGENTS_DIR)) {
    return NextResponse.json({ agents: [] });
  }

  const config = readConfig();

  // Skip non-phase directories (shared contains global skills, not agents)
  const SKIP_DIRS = new Set(["shared", "node_modules", ".git"]);
  const phases = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !SKIP_DIRS.has(d.name));

  for (const phase of phases) {
    const phaseDir = path.join(AGENTS_DIR, phase.name);
    const agentDirs = fs.readdirSync(phaseDir, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const agentDir of agentDirs) {
      const agentPath = path.join(phaseDir, agentDir.name);
      const promptPath = path.join(agentPath, "system-prompt.md");
      const rulesPath = path.join(agentPath, "rules.md");
      const skillsPath = path.join(agentPath, "skills");

      const hasSystemPrompt = fs.existsSync(promptPath);
      const hasRules = fs.existsSync(rulesPath);

      let skillsCount = 0;
      if (fs.existsSync(skillsPath)) {
        skillsCount = fs.readdirSync(skillsPath).filter(f => f.endsWith(".md")).length;
      }

      // Use config data if available, fall back to frontmatter
      const cfg = config[agentDir.name];
      const enabled = cfg?.enabled ?? true;
      const name = cfg?.name || agentDir.name;
      const role = cfg?.role || "";
      const automationLevel = cfg?.automation_level || "";

      agents.push({
        id: agentDir.name,
        name,
        phase: phase.name,
        role,
        automationLevel,
        enabled,
        hasSystemPrompt,
        hasRules,
        skillsCount,
      });
    }
  }

  const phaseOrder = ["meta", "research", "product", "legal", "design", "development", "quality", "release", "marketing", "feedback"];
  agents.sort((a, b) => {
    const ai = phaseOrder.indexOf(a.phase);
    const bi = phaseOrder.indexOf(b.phase);
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });

  return NextResponse.json({ agents });
}

// POST /api/agents — create new agent or manage existing
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  if (action === "toggle") {
    // Toggle enabled/disabled
    const { agentId, enabled } = body;
    const config = readConfig();
    if (config[agentId]) {
      config[agentId].enabled = enabled;
      writeConfig(config);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Agent not found in config" }, { status: 404 });
  }

  if (action === "delete") {
    // Delete agent (remove from config, optionally from disk)
    const { agentId, deleteFiles } = body;
    const config = readConfig();
    if (!config[agentId]) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const agentPath = path.resolve(process.cwd(), "..", config[agentId].path);

    // Validate path is within agents directory (prevent path traversal)
    const agentsBase = path.normalize(AGENTS_DIR);
    if (!path.normalize(agentPath).startsWith(agentsBase + path.sep)) {
      return NextResponse.json({ error: "Недопустимый путь агента" }, { status: 400 });
    }

    // Remove from config
    delete config[agentId];
    writeConfig(config);

    // Optionally remove files
    if (deleteFiles && fs.existsSync(agentPath)) {
      fs.rmSync(agentPath, { recursive: true, force: true });
    }

    return NextResponse.json({ ok: true });
  }

  if (action === "create") {
    // Create new agent
    const { agentId, name, phase, role } = body;

    if (!agentId || !phase) {
      return NextResponse.json({ error: "agentId and phase required" }, { status: 400 });
    }

    // Sanitize ID
    const safeId = agentId.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");

    // Check if exists
    const config = readConfig();
    if (config[safeId]) {
      return NextResponse.json({ error: "Agent already exists" }, { status: 409 });
    }

    // Create directory
    const agentDir = path.join(AGENTS_DIR, phase, safeId);
    fs.mkdirSync(path.join(agentDir, "skills"), { recursive: true });

    // Create system-prompt.md
    const promptContent = `---
name: ${name || safeId}
role: ${role || ""}
phase: ${phase}
automation_level: ""
inputs: []
outputs: []
tools: []
dependencies: []
---

# Роль

${role || "Описание роли агента..."}

# Инструкции

1. ...

# Формат выхода

...
`;
    fs.writeFileSync(path.join(agentDir, "system-prompt.md"), promptContent, "utf-8");

    // Create rules.md
    const rulesContent = `---
name: ${name || safeId} Rules
type: constraints
---

# Обязательные правила

- ...

# Запреты

- ...

# Критерии завершения

- ...
`;
    fs.writeFileSync(path.join(agentDir, "rules.md"), rulesContent, "utf-8");

    // Add to config
    config[safeId] = {
      enabled: true,
      phase,
      path: `agents/${phase}/${safeId}`,
      name: name || safeId,
      role: role || "",
      automation_level: "",
    };
    writeConfig(config);

    return NextResponse.json({ ok: true, id: safeId });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
