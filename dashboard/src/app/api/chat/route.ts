import { NextRequest, NextResponse } from "next/server";
import {
  getProjectState,
  addBlock,
  removeBlock,
  updateBlock,
  reorderBlocks,
  addAgentToBlock,
  removeAgentFromBlock,
  updateBlockDeps,
  resolveBlockApproval,
  restartCycle,
  updateSchedule,
  saveProjectState,
} from "@/lib/state";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

// Tools the chat agent can use
const TOOLS = [
  {
    name: "get_project_state",
    description: "Получить текущее состояние проекта: блоки, агенты, статусы",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "create_block",
    description: "Создать новый блок пайплайна",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Название блока" },
        description: { type: "string", description: "Описание задачи блока" },
        requires_approval: { type: "boolean", description: "Требуется ли подтверждение после завершения блока (по умолчанию true)" },
      },
      required: ["name"],
    },
  },
  {
    name: "delete_block",
    description: "Удалить блок пайплайна",
    input_schema: {
      type: "object" as const,
      properties: {
        block_id: { type: "string", description: "ID блока для удаления" },
      },
      required: ["block_id"],
    },
  },
  {
    name: "update_block",
    description: "Обновить название, описание или настройку approval блока",
    input_schema: {
      type: "object" as const,
      properties: {
        block_id: { type: "string", description: "ID блока" },
        name: { type: "string", description: "Новое название" },
        description: { type: "string", description: "Новое описание" },
        requires_approval: { type: "boolean", description: "Требуется ли подтверждение" },
      },
      required: ["block_id"],
    },
  },
  {
    name: "set_block_dependencies",
    description: "Установить зависимости блока — от каких блоков он зависит",
    input_schema: {
      type: "object" as const,
      properties: {
        block_id: { type: "string", description: "ID блока" },
        depends_on: {
          type: "array",
          items: { type: "string" },
          description: "Массив ID блоков, от которых зависит данный блок",
        },
      },
      required: ["block_id", "depends_on"],
    },
  },
  {
    name: "add_agent_to_block",
    description: "Добавить агента в блок. Агент — это AI-воркер с определённой ролью.",
    input_schema: {
      type: "object" as const,
      properties: {
        block_id: { type: "string", description: "ID блока" },
        agent_id: { type: "string", description: "ID агента (kebab-case, например: trend-researcher, scriptwriter, video-assembler)" },
      },
      required: ["block_id", "agent_id"],
    },
  },
  {
    name: "remove_agent_from_block",
    description: "Удалить агента из блока",
    input_schema: {
      type: "object" as const,
      properties: {
        block_id: { type: "string", description: "ID блока" },
        agent_id: { type: "string", description: "ID агента" },
      },
      required: ["block_id", "agent_id"],
    },
  },
  {
    name: "set_schedule",
    description: "Настроить расписание автоматического запуска проекта",
    input_schema: {
      type: "object" as const,
      properties: {
        preset: { type: "string", enum: ["hourly", "daily", "weekly", "custom"], description: "Пресет расписания" },
        cron: { type: "string", description: "Cron-выражение для custom пресета" },
        enabled: { type: "boolean", description: "Включено ли расписание" },
      },
      required: ["preset", "enabled"],
    },
  },
  {
    name: "restart_cycle",
    description: "Перезапустить цикл — сбросить всех агентов и начать заново",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
];

function buildSystemPrompt(projectId: string): string {
  return `Ты — AI-ассистент проекта "${projectId}" в системе Product Development Pipeline.

Ты помогаешь пользователю настраивать конвейер обработки задач: создавать блоки, добавлять агентов, настраивать зависимости и расписание.

## Что ты можешь:
- Создавать и удалять блоки пайплайна
- Добавлять и удалять агентов в блоках
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
problem-researcher, market-researcher, product-owner, business-analyst, legal-compliance, ux-ui-designer, pipeline-architect, system-architect, tech-lead, backend-developer, frontend-developer, devops-engineer, qa-engineer, security-engineer, release-manager, product-marketer, smm-manager, content-creator, customer-support, data-analyst

Пользователь также может создавать кастомных агентов с произвольными ID.`;
}

// Execute a tool call and return the result
function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  projectId: string
): string {
  try {
    switch (toolName) {
      case "get_project_state": {
        const state = getProjectState(projectId);
        if (!state) return JSON.stringify({ error: "Проект не найден" });
        const summary = {
          status: state.status,
          mode: state.mode,
          current_cycle: state.current_cycle,
          schedule: state.schedule,
          blocks: state.blocks?.map((b) => ({
            id: b.id,
            name: b.name,
            agents: b.agents,
            depends_on: b.depends_on,
            requires_approval: b.requires_approval,
            has_approval: !!b.approval,
          })),
          agent_count: Object.keys(state.agents).length,
        };
        return JSON.stringify(summary);
      }

      case "create_block": {
        const ok = addBlock(
          projectId,
          input.name as string,
          input.description as string | undefined,
          (input.requires_approval as boolean) ?? true
        );
        return ok
          ? JSON.stringify({ success: true, message: `Блок "${input.name}" создан` })
          : JSON.stringify({ error: "Не удалось создать блок" });
      }

      case "delete_block": {
        const ok = removeBlock(projectId, input.block_id as string);
        return ok
          ? JSON.stringify({ success: true, message: `Блок удалён` })
          : JSON.stringify({ error: "Не удалось удалить блок" });
      }

      case "update_block": {
        const ok = updateBlock(projectId, input.block_id as string, {
          name: input.name as string | undefined,
          description: input.description as string | undefined,
          requires_approval: input.requires_approval as boolean | undefined,
        });
        return ok
          ? JSON.stringify({ success: true, message: `Блок обновлён` })
          : JSON.stringify({ error: "Не удалось обновить блок" });
      }

      case "set_block_dependencies": {
        const ok = updateBlockDeps(
          projectId,
          input.block_id as string,
          input.depends_on as string[]
        );
        return ok
          ? JSON.stringify({ success: true, message: `Зависимости обновлены` })
          : JSON.stringify({ error: "Не удалось обновить зависимости" });
      }

      case "add_agent_to_block": {
        const ok = addAgentToBlock(
          projectId,
          input.block_id as string,
          input.agent_id as string
        );
        return ok
          ? JSON.stringify({ success: true, message: `Агент "${input.agent_id}" добавлен в блок` })
          : JSON.stringify({ error: "Не удалось добавить агента" });
      }

      case "remove_agent_from_block": {
        const ok = removeAgentFromBlock(
          projectId,
          input.block_id as string,
          input.agent_id as string
        );
        return ok
          ? JSON.stringify({ success: true, message: `Агент удалён из блока` })
          : JSON.stringify({ error: "Не удалось удалить агента" });
      }

      case "set_schedule": {
        const ok = updateSchedule(projectId, {
          preset: input.preset as string,
          cron: input.cron as string | undefined,
          enabled: input.enabled as boolean,
        });
        return ok
          ? JSON.stringify({ success: true, message: `Расписание обновлено` })
          : JSON.stringify({ error: "Не удалось обновить расписание" });
      }

      case "restart_cycle": {
        const ok = restartCycle(projectId);
        return ok
          ? JSON.stringify({ success: true, message: `Цикл перезапущен` })
          : JSON.stringify({ error: "Не удалось перезапустить цикл" });
      }

      default:
        return JSON.stringify({ error: `Неизвестный инструмент: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({ error: String(err) });
  }
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY не настроен. Добавьте его в dashboard/.env.local" },
      { status: 500 }
    );
  }

  const { projectId, messages } = (await request.json()) as {
    projectId: string;
    messages: Array<{ role: string; content: string }>;
  };

  if (!projectId || !messages?.length) {
    return NextResponse.json({ error: "projectId и messages обязательны" }, { status: 400 });
  }

  const systemPrompt = buildSystemPrompt(projectId);

  // Claude API conversation loop with tool use
  let currentMessages = messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const MAX_TOOL_ROUNDS = 10;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Fetch with retry on 429/529 (rate limit / overloaded)
    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4096,
          system: systemPrompt,
          tools: TOOLS,
          messages: currentMessages,
        }),
      });

      if (response.status === 429 || response.status === 529) {
        const delay = (attempt + 1) * 2000; // 2s, 4s, 6s
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }

    if (!response || !response.ok) {
      const errText = response ? await response.text() : "No response";
      return NextResponse.json(
        { error: `Claude API error: ${response?.status || 0} — попробуйте через минуту` },
        { status: 502 }
      );
    }

    const data = await response.json();

    // Check if Claude wants to use tools
    if (data.stop_reason === "tool_use") {
      // Add assistant message with tool_use blocks
      currentMessages.push({ role: "assistant", content: data.content });

      // Execute each tool call
      const toolResults: Array<{
        type: "tool_result";
        tool_use_id: string;
        content: string;
      }> = [];

      for (const block of data.content) {
        if (block.type === "tool_use") {
          const result = executeTool(block.name, block.input, projectId);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      // Add tool results as user message
      currentMessages.push({ role: "user", content: toolResults } as any);
      continue;
    }

    // Extract text response
    const textBlocks = data.content?.filter((b: any) => b.type === "text") || [];
    const responseText = textBlocks.map((b: any) => b.text).join("\n");

    return NextResponse.json({
      response: responseText,
      // Return only user-visible messages for the frontend to track
      tool_calls_count: round,
    });
  }

  return NextResponse.json({
    response: "Превышен лимит вызовов инструментов. Попробуйте разбить запрос на части.",
    tool_calls_count: MAX_TOOL_ROUNDS,
  });
}
