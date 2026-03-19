import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const AGENTS_DIR = path.resolve(process.cwd(), "..", "agents");

function findAgentDir(agentName: string): string | null {
  if (!fs.existsSync(AGENTS_DIR)) return null;
  const phases = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());
  for (const phase of phases) {
    const agentPath = path.join(AGENTS_DIR, phase.name, agentName);
    if (fs.existsSync(agentPath)) return agentPath;
  }
  return null;
}

function getSkills(agentDir: string): { name: string; content: string }[] {
  const skillsDir = path.join(agentDir, "skills");
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir)
    .filter(f => f.endsWith(".md"))
    .map(f => ({
      name: f,
      content: fs.readFileSync(path.join(skillsDir, f), "utf-8"),
    }));
}

// GET /api/agents/[name] — read agent files
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const agentDir = findAgentDir(name);
  if (!agentDir) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const promptPath = path.join(agentDir, "system-prompt.md");
  const rulesPath = path.join(agentDir, "rules.md");

  const systemPrompt = fs.existsSync(promptPath)
    ? fs.readFileSync(promptPath, "utf-8")
    : "";
  const rules = fs.existsSync(rulesPath)
    ? fs.readFileSync(rulesPath, "utf-8")
    : "";
  const skills = getSkills(agentDir);

  // Get phase from directory
  const rel = path.relative(AGENTS_DIR, agentDir);
  const phase = rel.split(path.sep)[0];

  return NextResponse.json({
    id: name,
    phase,
    systemPrompt,
    rules,
    skills,
  });
}

// POST /api/agents/[name] — save agent files
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const agentDir = findAgentDir(name);
  if (!agentDir) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const body = await req.json();
  const { file, content, skillName } = body;

  if (file === "system-prompt") {
    fs.writeFileSync(path.join(agentDir, "system-prompt.md"), content, "utf-8");
  } else if (file === "rules") {
    fs.writeFileSync(path.join(agentDir, "rules.md"), content, "utf-8");
  } else if (file === "skill" && skillName) {
    const skillsDir = path.join(agentDir, "skills");
    if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });
    const safeName = skillName.replace(/[^a-zA-Z0-9_-]/g, "");
    const fileName = safeName.endsWith(".md") ? safeName : `${safeName}.md`;
    fs.writeFileSync(path.join(skillsDir, fileName), content, "utf-8");
  } else if (file === "delete-skill" && skillName) {
    const skillPath = path.join(agentDir, "skills", skillName);
    if (fs.existsSync(skillPath)) fs.unlinkSync(skillPath);
  } else {
    return NextResponse.json({ error: "Unknown file type" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

// PUT /api/agents/[name] — upload file (multipart not needed, accept raw content)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const agentDir = findAgentDir(name);
  if (!agentDir) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const body = await req.json();
  const { target, content, fileName } = body;

  if (target === "system-prompt") {
    fs.writeFileSync(path.join(agentDir, "system-prompt.md"), content, "utf-8");
    return NextResponse.json({ ok: true, saved: "system-prompt.md" });
  } else if (target === "rules") {
    fs.writeFileSync(path.join(agentDir, "rules.md"), content, "utf-8");
    return NextResponse.json({ ok: true, saved: "rules.md" });
  } else if (target === "skill") {
    const skillsDir = path.join(agentDir, "skills");
    if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });
    const safeName = (fileName || "skill").replace(/[^a-zA-Z0-9_.-]/g, "");
    const finalName = safeName.endsWith(".md") ? safeName : `${safeName}.md`;
    fs.writeFileSync(path.join(skillsDir, finalName), content, "utf-8");
    return NextResponse.json({ ok: true, saved: finalName });
  }

  return NextResponse.json({ error: "Unknown target" }, { status: 400 });
}
