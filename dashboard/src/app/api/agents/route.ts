import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const AGENTS_DIR = path.resolve(process.cwd(), "..", "agents");

interface AgentInfo {
  id: string;
  name: string;
  phase: string;
  role: string;
  automationLevel: string;
  hasSystemPrompt: boolean;
  hasRules: boolean;
  skillsCount: number;
}

function parseYamlFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    }
  }
  return result;
}

export async function GET() {
  const agents: AgentInfo[] = [];

  // Walk agents directory: agents/{phase}/{agent-name}/
  if (!fs.existsSync(AGENTS_DIR)) {
    return NextResponse.json({ agents: [] });
  }

  const phases = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());

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

      let name = agentDir.name;
      let role = "";
      let automationLevel = "";

      if (hasSystemPrompt) {
        const content = fs.readFileSync(promptPath, "utf-8");
        const fm = parseYamlFrontmatter(content);
        if (fm.name) name = fm.name;
        if (fm.role) role = fm.role;
        if (fm.automation_level) automationLevel = fm.automation_level;
      }

      agents.push({
        id: agentDir.name,
        name,
        phase: phase.name,
        role,
        automationLevel,
        hasSystemPrompt,
        hasRules,
        skillsCount,
      });
    }
  }

  // Sort by phase order
  const phaseOrder = ["meta", "research", "product", "legal", "design", "development", "quality", "release", "marketing", "feedback"];
  agents.sort((a, b) => {
    const ai = phaseOrder.indexOf(a.phase);
    const bi = phaseOrder.indexOf(b.phase);
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });

  return NextResponse.json({ agents });
}
