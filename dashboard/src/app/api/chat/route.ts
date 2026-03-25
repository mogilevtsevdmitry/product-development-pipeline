import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const MCP_SERVER_PATH = path.resolve(
  process.cwd(),
  "src",
  "mcp",
  "pipeline-server.mjs"
);

function buildSystemPrompt(projectId: string): string {
  return `Ты — AI-ассистент проекта "${projectId}" в системе Product Development Pipeline.

Ты помогаешь пользователю настраивать конвейер обработки задач: создавать блоки, добавлять агентов, настраивать зависимости и расписание.

## Что ты можешь (через MCP tools):
- Создавать и удалять блоки пайплайна
- Добавлять и удалять агентов в блоках
- Добавлять зависимости между агентами внутри блока (add_edge_in_block)
- Настраивать зависимости между блоками (какой блок должен завершиться перед запуском другого)
- Настраивать расписание автоматического запуска
- Перезапускать цикл выполнения

## Правила:
- Агент — это AI-воркер. ID агента в kebab-case (например: trend-researcher, content-writer, video-assembler)
- Блок — группа агентов, работающих над одной задачей
- Блоки могут зависеть друг от друга (DAG)
- Используй tool get_project_state чтобы увидеть текущее состояние перед внесением изменений
- Отвечай по-русски, кратко и по делу
- После создания нескольких блоков, предлагай настроить зависимости между ними

## Доступные встроенные агенты:
problem-researcher, market-researcher, product-owner, business-analyst, legal-compliance, ux-ui-designer, pipeline-architect, system-architect, tech-lead, backend-developer, frontend-developer, devops-engineer, qa-engineer, security-engineer, release-manager, product-marketer, smm-manager, content-creator, customer-support, data-analyst, trend-researcher, catalog-analyst, content-strategist, post-writer, script-writer, story-writer, image-generator, video-generator, music-composer, content-assembler, quality-checker, telegram-poster, instagram-poster, youtube-poster, analytics-collector

Пользователь также может создавать кастомных агентов с произвольными ID.`;
}

export async function POST(request: NextRequest) {
  const { projectId, messages } = (await request.json()) as {
    projectId: string;
    messages: Array<{ role: string; content: string }>;
  };

  if (!projectId || !messages?.length) {
    return NextResponse.json(
      { error: "projectId и messages обязательны" },
      { status: 400 }
    );
  }

  // Build the full prompt: system prompt + conversation history + latest user message
  const systemPrompt = buildSystemPrompt(projectId);

  // Format conversation as a single prompt for claude CLI
  let conversationText = "";
  for (const msg of messages) {
    if (msg.role === "user") {
      conversationText += `\nПользователь: ${msg.content}\n`;
    } else if (msg.role === "assistant") {
      conversationText += `\nАссистент: ${msg.content}\n`;
    }
  }

  const fullPrompt = `${systemPrompt}\n\n# Диалог\n${conversationText}\n\nОтветь на последнее сообщение пользователя. Используй MCP tools при необходимости.`;

  // Write prompt to temp file
  const tmpFile = path.join(
    os.tmpdir(),
    `pipeline-chat-${projectId}-${Date.now()}.md`
  );
  fs.writeFileSync(tmpFile, fullPrompt, "utf-8");

  // Build MCP config for claude CLI
  const mcpConfig = JSON.stringify({
    mcpServers: {
      "pipeline-tools": {
        command: "node",
        args: [MCP_SERVER_PATH],
        env: {
          PROJECT_ID: projectId,
        },
      },
    },
  });

  try {
    // Run claude CLI with MCP server
    const cmd = `cat "${tmpFile}" | claude --print --model sonnet --dangerously-skip-permissions --mcp-config '${mcpConfig}'`;

    const result = execSync(cmd, {
      encoding: "utf-8",
      timeout: 120_000, // 2 min timeout
      maxBuffer: 10 * 1024 * 1024, // 10MB
      env: {
        ...process.env,
        PROJECT_ID: projectId,
      },
    });

    // Clean up temp file
    try { fs.unlinkSync(tmpFile); } catch { /* */ }

    return NextResponse.json({
      response: result.trim(),
      tool_calls_count: 0, // CLI handles tool calls internally
    });
  } catch (err: unknown) {
    // Clean up temp file
    try { fs.unlinkSync(tmpFile); } catch { /* */ }

    const error = err as { status?: number; stderr?: string; stdout?: string; message?: string };

    // If claude CLI produced output before failing, return it
    if (error.stdout?.trim()) {
      return NextResponse.json({
        response: error.stdout.trim(),
        tool_calls_count: 0,
      });
    }

    const errMsg = error.stderr || error.message || "Неизвестная ошибка";
    console.error("[chat] Claude CLI error:", errMsg);

    return NextResponse.json(
      { error: `Ошибка Claude CLI: ${errMsg.slice(0, 200)}` },
      { status: 502 }
    );
  }
}
