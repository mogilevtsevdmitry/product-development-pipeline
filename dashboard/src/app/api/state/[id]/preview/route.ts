import { NextRequest, NextResponse } from "next/server";
import { getProjectState, saveProjectState } from "@/lib/state";
import { spawn, execSync, spawnSync } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";

const CLAUDE_PATH = "claude";
const NODE_BIN = "/Users/dmitry/.nvm/versions/node/v22.20.0/bin";
const ENV_PATH = `${NODE_BIN}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;

/**
 * Find a free port in range 10000-60000.
 */
function findFreePort(): number {
  for (let i = 0; i < 20; i++) {
    const port = 10000 + Math.floor(Math.random() * 50000);
    try {
      const result = spawnSync("lsof", ["-i", `:${port}`], { timeout: 3000 });
      if (!result.stdout?.toString().trim()) return port;
    } catch {
      return port;
    }
  }
  return 10000 + Math.floor(Math.random() * 50000);
}

/**
 * POST /api/state/[id]/preview
 * Body: { action: "start" | "stop" }
 */
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

    if (!state.project_path || !fs.existsSync(state.project_path)) {
      return NextResponse.json(
        { error: "Project path not set or does not exist" },
        { status: 400 }
      );
    }

    const projectPath = state.project_path;

    if (action === "start") {
      if (state.preview?.status === "running" || state.preview?.status === "starting") {
        return NextResponse.json(
          { error: "Preview already " + state.preview.status },
          { status: 409 }
        );
      }

      // Update state to starting
      state.preview = {
        status: "starting",
        started_at: new Date().toISOString(),
      };
      state.updated_at = new Date().toISOString();
      saveProjectState(id, state);

      // Run in background
      setImmediate(() => runPreview(id, projectPath));

      return NextResponse.json({ status: "starting" });

    } else if (action === "stop") {
      const composeFile = state.preview?.compose_file
        || path.join(projectPath, "docker-compose.preview.yml");

      if (fs.existsSync(composeFile)) {
        try {
          execSync(
            `docker compose -f "${composeFile}" down --remove-orphans 2>&1`,
            { cwd: projectPath, timeout: 30000, env: { ...process.env, PATH: ENV_PATH } }
          );
        } catch { /* best effort */ }
      }

      state.preview = { status: "stopped" };
      state.updated_at = new Date().toISOString();
      saveProjectState(id, state);

      return NextResponse.json({ status: "stopped" });

    } else {
      return NextResponse.json(
        { error: "Invalid action. Use 'start' or 'stop'" },
        { status: 400 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * Two-phase preview launch:
 * Phase 1: Generate Docker configs via claude --print (if missing)
 * Phase 2: Build, run, and verify via shell commands
 */
async function runPreview(projectId: string, projectPath: string) {
  const composeFile = path.join(projectPath, "docker-compose.preview.yml");
  let appPort = findFreePort();
  let dbPort = findFreePort();

  try {
    // Phase 1: Generate Docker configs if missing
    if (!fs.existsSync(composeFile)) {
      const generated = await generateDockerConfigs(projectPath, appPort, dbPort);
      if (!generated) {
        updatePreviewState(projectId, {
          status: "failed",
          error: "Failed to generate Docker configuration",
        });
        return;
      }
    } else {
      // Existing compose file — read app port from it
      const ports = readPortsFromCompose(composeFile);
      if (ports.app) appPort = ports.app;
      if (ports.db) dbPort = ports.db;
    }

    // Copy .env if needed
    const envExample = path.join(projectPath, ".env.example");
    const envFile = path.join(projectPath, ".env");
    if (fs.existsSync(envExample) && !fs.existsSync(envFile)) {
      fs.copyFileSync(envExample, envFile);
    }

    // Phase 2: Build and run
    const buildResult = spawnSync(
      "docker",
      ["compose", "-f", "docker-compose.preview.yml", "up", "-d", "--build"],
      {
        cwd: projectPath,
        timeout: 180000, // 3 min for build
        env: { ...process.env, PATH: ENV_PATH },
      }
    );

    if (buildResult.status !== 0) {
      updatePreviewState(projectId, {
        status: "failed",
        error: "Docker build failed",
        logs: (buildResult.stderr?.toString() || buildResult.stdout?.toString() || "").slice(-2000),
      });
      return;
    }

    // Wait for containers to start
    await sleep(10000);

    // Check containers are running
    const psResult = spawnSync(
      "docker",
      ["compose", "-f", "docker-compose.preview.yml", "ps", "--format", "json"],
      { cwd: projectPath, timeout: 10000, env: { ...process.env, PATH: ENV_PATH } }
    );

    const psOutput = psResult.stdout?.toString() || "";
    if (psOutput.includes('"exited"') || psOutput.includes('"dead"')) {
      const logsResult = spawnSync(
        "docker",
        ["compose", "-f", "docker-compose.preview.yml", "logs", "--tail=50"],
        { cwd: projectPath, timeout: 10000, env: { ...process.env, PATH: ENV_PATH } }
      );
      updatePreviewState(projectId, {
        status: "failed",
        error: "Containers exited unexpectedly",
        logs: (logsResult.stdout?.toString() || "").slice(-2000),
      });
      return;
    }

    // Health check — probe root and common webapp paths
    const probePaths = ["/", "/webapp", "/webapp/", "/app", "/health"];
    let bestUrl = `http://localhost:${appPort}`;
    let healthy = false;

    for (let attempt = 0; attempt < 3; attempt++) {
      for (const probePath of probePaths) {
        const curlResult = spawnSync(
          "curl",
          ["-s", "-o", "/dev/null", "-w", "%{http_code}|%{content_type}", `http://localhost:${appPort}${probePath}`],
          { timeout: 5000 }
        );
        const output = curlResult.stdout?.toString().trim() || "";
        const [codeStr, contentType] = output.split("|");
        const httpCode = parseInt(codeStr || "0", 10);

        if (httpCode >= 200 && httpCode < 400) {
          healthy = true;
          // Prefer paths that return HTML (actual web pages) over JSON APIs
          if (contentType?.includes("text/html")) {
            bestUrl = `http://localhost:${appPort}${probePath}`;
            break;
          }
          // If root returns HTML, that's the best
          if (probePath === "/") {
            bestUrl = `http://localhost:${appPort}`;
          }
        }
      }
      if (healthy) break;
      await sleep(5000);
    }

    if (!healthy) {
      // Still save as running — app may need more time
      const logsResult = spawnSync(
        "docker",
        ["compose", "-f", "docker-compose.preview.yml", "logs", "--tail=30"],
        { cwd: projectPath, timeout: 10000, env: { ...process.env, PATH: ENV_PATH } }
      );
      const ps2 = spawnSync(
        "docker",
        ["compose", "-f", "docker-compose.preview.yml", "ps", "-q"],
        { cwd: projectPath, timeout: 5000, env: { ...process.env, PATH: ENV_PATH } }
      );
      if (ps2.stdout?.toString().trim()) {
        updatePreviewState(projectId, {
          status: "running",
          url: bestUrl,
          ports: { app: appPort, db: dbPort },
          compose_file: composeFile,
        });
        return;
      }
      updatePreviewState(projectId, {
        status: "failed",
        error: "App not responding on port " + appPort,
        logs: (logsResult.stdout?.toString() || "").slice(-2000),
      });
      return;
    }

    // Success!
    updatePreviewState(projectId, {
      status: "running",
      url: bestUrl,
      ports: { app: appPort, db: dbPort },
      compose_file: composeFile,
    });
  } catch (err) {
    updatePreviewState(projectId, {
      status: "failed",
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

function updatePreviewState(projectId: string, preview: Record<string, any>) {
  const state = getProjectState(projectId);
  if (!state) return;
  state.preview = {
    ...state.preview,
    ...preview,
  } as any;
  state.updated_at = new Date().toISOString();
  saveProjectState(projectId, state);
}

/**
 * Generate Docker configs using claude --print.
 * Returns true if files were created.
 */
async function generateDockerConfigs(
  projectPath: string,
  appPort: number,
  dbPort: number
): Promise<boolean> {
  const pkgPath = path.join(projectPath, "package.json");
  if (!fs.existsSync(pkgPath)) return false;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const scripts = pkg.scripts || {};

  // Detect stack
  let framework = "node";
  if (deps["next"]) framework = "nextjs";
  else if (deps["@nestjs/core"]) framework = "nestjs";
  else if (deps["express"]) framework = "express";
  else if (deps["fastify"]) framework = "fastify";
  else if (deps["hono"]) framework = "hono";
  else if (deps["vite"] || deps["react"]) framework = "vite-react";
  else if (deps["vue"]) framework = "vue";

  const needsDb = !!(deps["prisma"] || deps["typeorm"] || deps["pg"] || deps["mysql2"] || deps["mongoose"]);
  const hasBuild = !!scripts.build;
  const startCmd = scripts.start || (hasBuild ? "node dist/server.js" : "node src/server.js");
  const internalPort = framework === "nextjs" ? 3000 : (framework === "vite-react" || framework === "vue") ? 5173 : 3001;

  // Generate Dockerfile
  const dockerfile = path.join(projectPath, "Dockerfile");
  if (!fs.existsSync(dockerfile)) {
    const dockerfileContent = `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
${hasBuild ? "RUN npm run build" : ""}

FROM node:20-alpine
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=builder /app .
${needsDb && deps["prisma"] ? "RUN npx prisma generate" : ""}
USER appuser
EXPOSE ${internalPort}
CMD [${startCmd.split(" ").map((s: string) => `"${s}"`).join(", ")}]
`;
    fs.writeFileSync(dockerfile, dockerfileContent, "utf-8");
  }

  // Generate docker-compose.preview.yml
  const envFile = path.join(projectPath, ".env");
  const hasEnvFile = fs.existsSync(envFile);

  let composeContent = `services:
  app:
    build: .
    ports:
      - "${appPort}:${internalPort}"
`;

  if (hasEnvFile) {
    composeContent += `    env_file:
      - .env
`;
  }

  composeContent += `    environment:
      - NODE_ENV=production
      - PORT=${internalPort}
`;

  if (needsDb) {
    composeContent += `      - DATABASE_URL=postgresql://preview:preview@db:5432/preview
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    ports:
      - "${dbPort}:5432"
    environment:
      - POSTGRES_USER=preview
      - POSTGRES_PASSWORD=preview
      - POSTGRES_DB=preview
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U preview"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped
    volumes:
      - preview_db:/var/lib/postgresql/data

volumes:
  preview_db:
`;
  } else {
    composeContent += `    restart: unless-stopped
`;
  }

  // Handle env vars from .env.example (only if no .env file exists)
  if (!hasEnvFile) {
    const envExample = path.join(projectPath, ".env.example");
    if (fs.existsSync(envExample)) {
      const envContent = fs.readFileSync(envExample, "utf-8");
      const envLines = envContent.split("\n")
        .filter((l: string) => l.trim() && !l.startsWith("#"))
        .map((l: string) => {
          const [key] = l.split("=");
          return key?.trim();
        })
        .filter(Boolean);

      // Generate placeholder values for common env var patterns
      const extraEnv: Record<string, string> = {};
      for (const key of envLines) {
        if (key.includes("SECRET") || key.includes("KEY") || key.includes("TOKEN") || key.includes("PASSWORD")) {
          extraEnv[key] = "preview-secret-" + Math.random().toString(36).slice(2);
        } else if (key.includes("CORS") || key.includes("ORIGIN")) {
          extraEnv[key] = `http://localhost:${appPort}`;
        } else if (key.includes("COOKIE_DOMAIN")) {
          extraEnv[key] = "localhost";
        } else if (key === "PORT") {
          extraEnv[key] = String(internalPort);
        }
      }

      if (Object.keys(extraEnv).length > 0) {
        const envYaml = Object.entries(extraEnv)
          .map(([k, v]) => `      - ${k}=${v}`)
          .join("\n");
        composeContent = composeContent.replace(
          `      - PORT=${internalPort}`,
          `      - PORT=${internalPort}\n${envYaml}`
        );
      }
    }
  }

  const composeFile = path.join(projectPath, "docker-compose.preview.yml");
  fs.writeFileSync(composeFile, composeContent, "utf-8");

  return true;
}

/**
 * Read port mappings from an existing compose file.
 * Finds the "app" service port (not db/postgres).
 */
function readPortsFromCompose(composeFile: string): { app?: number; db?: number } {
  const content = fs.readFileSync(composeFile, "utf-8");
  const result: { app?: number; db?: number } = {};

  // Find all port mappings: "HOST:CONTAINER"
  const portMatches = [...content.matchAll(/-\s*"?(\d+):(\d+)"?/g)];

  for (const match of portMatches) {
    const hostPort = parseInt(match[1], 10);
    const containerPort = parseInt(match[2], 10);

    // 5432 = PostgreSQL, 3306 = MySQL, 27017 = MongoDB
    if ([5432, 3306, 27017].includes(containerPort)) {
      result.db = hostPort;
    } else {
      // First non-db port is the app port
      if (!result.app) result.app = hostPort;
    }
  }

  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
