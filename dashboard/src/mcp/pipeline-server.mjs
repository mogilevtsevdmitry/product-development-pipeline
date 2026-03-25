#!/usr/bin/env node
/**
 * MCP Server for Pipeline Management tools.
 * Provides tools for managing blocks, agents, schedules, and cycles.
 * Communicates via stdio (stdin/stdout) using JSON-RPC 2.0.
 *
 * Usage: PROJECT_ID=my-project node pipeline-server.mjs
 */

import fs from "fs";
import path from "path";
import { createInterface } from "readline";

const PROJECT_ID = process.env.PROJECT_ID;
if (!PROJECT_ID) {
  process.stderr.write("ERROR: PROJECT_ID environment variable is required\n");
  process.exit(1);
}

// Resolve paths: this file is at dashboard/src/mcp/pipeline-server.mjs
// Project root is 3 levels up
const THIS_DIR = decodeURIComponent(path.dirname(new URL(import.meta.url).pathname));
const PROJECT_ROOT = path.resolve(THIS_DIR, "..", "..", "..");
const STATE_DIR = path.join(PROJECT_ROOT, "orchestrator", "state");
const PROJECTS_DIR = path.join(PROJECT_ROOT, "projects");

// ============================================================================
// State helpers (lightweight — read/write JSON directly, no TS imports)
// ============================================================================

function readState() {
  const fp = path.join(STATE_DIR, `${PROJECT_ID}.json`);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, "utf-8"));
}

function writeState(state) {
  const fp = path.join(STATE_DIR, `${PROJECT_ID}.json`);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  state.updated_at = new Date().toISOString();
  fs.writeFileSync(fp, JSON.stringify(state, null, 2), "utf-8");
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-|-$/g, "") || `block-${Date.now()}`;
}

// ============================================================================
// Tool implementations
// ============================================================================

function getProjectState() {
  const state = readState();
  if (!state) return { error: "Проект не найден" };
  return {
    status: state.status,
    mode: state.mode,
    current_cycle: state.current_cycle || 1,
    schedule: state.schedule,
    blocks: (state.blocks || []).map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      agents: b.agents,
      edges: b.edges,
      depends_on: b.depends_on,
      requires_approval: b.requires_approval,
      has_approval: !!b.approval,
    })),
    agent_count: Object.keys(state.agents || {}).length,
    agents_summary: Object.entries(state.agents || {}).map(([id, a]) => ({
      id,
      status: a.status,
    })),
  };
}

function createBlock(name, description, requiresApproval = true) {
  const state = readState();
  if (!state) return { error: "Проект не найден" };
  if (!state.blocks) state.blocks = [];

  const blockId = slugify(name);
  if (state.blocks.find((b) => b.id === blockId)) {
    return { error: `Блок с ID "${blockId}" уже существует` };
  }

  state.blocks.push({
    id: blockId,
    name,
    description: description || undefined,
    agents: [],
    edges: [],
    depends_on: [],
    requires_approval: requiresApproval,
  });

  writeState(state);
  return { success: true, block_id: blockId, message: `Блок "${name}" создан` };
}

function deleteBlock(blockId) {
  const state = readState();
  if (!state || !state.blocks) return { error: "Проект не найден" };

  const idx = state.blocks.findIndex((b) => b.id === blockId);
  if (idx < 0) return { error: `Блок "${blockId}" не найден` };

  // Remove deps references from other blocks
  for (const b of state.blocks) {
    b.depends_on = (b.depends_on || []).filter((d) => d !== blockId);
  }

  state.blocks.splice(idx, 1);
  writeState(state);
  return { success: true, message: `Блок "${blockId}" удалён` };
}

function updateBlockFn(blockId, updates) {
  const state = readState();
  if (!state || !state.blocks) return { error: "Проект не найден" };

  const block = state.blocks.find((b) => b.id === blockId);
  if (!block) return { error: `Блок "${blockId}" не найден` };

  if (updates.name !== undefined) block.name = updates.name;
  if (updates.description !== undefined) block.description = updates.description;
  if (updates.requires_approval !== undefined) block.requires_approval = updates.requires_approval;

  writeState(state);
  return { success: true, message: `Блок "${blockId}" обновлён` };
}

function setBlockDependencies(blockId, dependsOn) {
  const state = readState();
  if (!state || !state.blocks) return { error: "Проект не найден" };

  const block = state.blocks.find((b) => b.id === blockId);
  if (!block) return { error: `Блок "${blockId}" не найден` };

  block.depends_on = dependsOn;
  writeState(state);
  return { success: true, message: `Зависимости блока "${blockId}" обновлены: [${dependsOn.join(", ")}]` };
}

function addAgentToBlockFn(blockId, agentId) {
  const state = readState();
  if (!state || !state.blocks) return { error: "Проект не найден" };

  const block = state.blocks.find((b) => b.id === blockId);
  if (!block) return { error: `Блок "${blockId}" не найден` };
  if (block.agents.includes(agentId)) return { success: true, message: `Агент "${agentId}" уже в блоке` };

  block.agents.push(agentId);

  // Init agent state
  if (!state.agents) state.agents = {};
  if (!state.agents[agentId]) {
    state.agents[agentId] = {
      status: "pending",
      started_at: null,
      completed_at: null,
      artifacts: [],
      error: null,
    };
  }

  // Add to pipeline_graph
  if (!state.pipeline_graph) state.pipeline_graph = { nodes: [], edges: [], parallel_groups: [] };
  if (!state.pipeline_graph.nodes.includes(agentId)) {
    state.pipeline_graph.nodes.push(agentId);
  }

  writeState(state);
  return { success: true, message: `Агент "${agentId}" добавлен в блок "${blockId}"` };
}

function removeAgentFromBlockFn(blockId, agentId) {
  const state = readState();
  if (!state || !state.blocks) return { error: "Проект не найден" };

  const block = state.blocks.find((b) => b.id === blockId);
  if (!block) return { error: `Блок "${blockId}" не найден` };

  block.agents = block.agents.filter((a) => a !== agentId);
  block.edges = (block.edges || []).filter(([s, t]) => s !== agentId && t !== agentId);

  writeState(state);
  return { success: true, message: `Агент "${agentId}" удалён из блока "${blockId}"` };
}

function addEdgeInBlock(blockId, fromAgent, toAgent) {
  const state = readState();
  if (!state || !state.blocks) return { error: "Проект не найден" };

  const block = state.blocks.find((b) => b.id === blockId);
  if (!block) return { error: `Блок "${blockId}" не найден` };

  if (!block.agents.includes(fromAgent)) return { error: `Агент "${fromAgent}" не в блоке` };
  if (!block.agents.includes(toAgent)) return { error: `Агент "${toAgent}" не в блоке` };

  const exists = (block.edges || []).some(([s, t]) => s === fromAgent && t === toAgent);
  if (exists) return { success: true, message: "Связь уже существует" };

  if (!block.edges) block.edges = [];
  block.edges.push([fromAgent, toAgent]);

  writeState(state);
  return { success: true, message: `Связь ${fromAgent} → ${toAgent} добавлена` };
}

function setSchedule(preset, enabled, cron) {
  const state = readState();
  if (!state) return { error: "Проект не найден" };

  state.schedule = { preset, enabled, ...(cron ? { cron } : {}) };
  writeState(state);
  return { success: true, message: `Расписание: ${preset}, ${enabled ? "включено" : "выключено"}` };
}

function restartCycleFn() {
  const state = readState();
  if (!state) return { error: "Проект не найден" };

  // Reset all agents
  for (const agent of Object.values(state.agents || {})) {
    agent.status = "pending";
    agent.started_at = null;
    agent.completed_at = null;
    agent.error = null;
    agent.artifacts = [];
  }

  // Clear block approvals
  for (const block of state.blocks || []) {
    delete block.approval;
  }

  state.status = "created";
  state.current_gate = null;
  state.current_cycle = (state.current_cycle || 1) + 1;
  if (!state.cycle_history) state.cycle_history = [];

  writeState(state);
  return { success: true, message: `Цикл #${state.current_cycle} начат` };
}

// ============================================================================
// MCP Protocol (JSON-RPC 2.0 over stdio)
// ============================================================================

const TOOLS_META = [
  {
    name: "get_project_state",
    description: "Получить текущее состояние проекта: блоки, агенты, статусы, расписание",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_block",
    description: "Создать новый блок пайплайна",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Название блока" },
        description: { type: "string", description: "Описание задачи блока" },
        requires_approval: { type: "boolean", description: "Требуется ли подтверждение (default: true)" },
      },
      required: ["name"],
    },
  },
  {
    name: "delete_block",
    description: "Удалить блок пайплайна",
    inputSchema: {
      type: "object",
      properties: {
        block_id: { type: "string", description: "ID блока" },
      },
      required: ["block_id"],
    },
  },
  {
    name: "update_block",
    description: "Обновить название, описание или approval блока",
    inputSchema: {
      type: "object",
      properties: {
        block_id: { type: "string", description: "ID блока" },
        name: { type: "string" },
        description: { type: "string" },
        requires_approval: { type: "boolean" },
      },
      required: ["block_id"],
    },
  },
  {
    name: "set_block_dependencies",
    description: "Установить зависимости блока (от каких блоков он зависит)",
    inputSchema: {
      type: "object",
      properties: {
        block_id: { type: "string", description: "ID блока" },
        depends_on: { type: "array", items: { type: "string" }, description: "ID блоков-зависимостей" },
      },
      required: ["block_id", "depends_on"],
    },
  },
  {
    name: "add_agent_to_block",
    description: "Добавить агента в блок",
    inputSchema: {
      type: "object",
      properties: {
        block_id: { type: "string", description: "ID блока" },
        agent_id: { type: "string", description: "ID агента (kebab-case)" },
      },
      required: ["block_id", "agent_id"],
    },
  },
  {
    name: "remove_agent_from_block",
    description: "Удалить агента из блока",
    inputSchema: {
      type: "object",
      properties: {
        block_id: { type: "string", description: "ID блока" },
        agent_id: { type: "string", description: "ID агента" },
      },
      required: ["block_id", "agent_id"],
    },
  },
  {
    name: "add_edge_in_block",
    description: "Добавить зависимость между агентами внутри блока (агент B запускается после агента A)",
    inputSchema: {
      type: "object",
      properties: {
        block_id: { type: "string", description: "ID блока" },
        from_agent: { type: "string", description: "ID агента-источника" },
        to_agent: { type: "string", description: "ID агента-зависимого" },
      },
      required: ["block_id", "from_agent", "to_agent"],
    },
  },
  {
    name: "set_schedule",
    description: "Настроить расписание автоматического запуска",
    inputSchema: {
      type: "object",
      properties: {
        preset: { type: "string", enum: ["hourly", "daily", "weekly", "custom"] },
        enabled: { type: "boolean" },
        cron: { type: "string", description: "Cron для custom" },
      },
      required: ["preset", "enabled"],
    },
  },
  {
    name: "restart_cycle",
    description: "Перезапустить цикл — сбросить всех агентов в pending",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

function handleToolCall(name, args) {
  switch (name) {
    case "get_project_state":
      return getProjectState();
    case "create_block":
      return createBlock(args.name, args.description, args.requires_approval ?? true);
    case "delete_block":
      return deleteBlock(args.block_id);
    case "update_block":
      return updateBlockFn(args.block_id, args);
    case "set_block_dependencies":
      return setBlockDependencies(args.block_id, args.depends_on);
    case "add_agent_to_block":
      return addAgentToBlockFn(args.block_id, args.agent_id);
    case "remove_agent_from_block":
      return removeAgentFromBlockFn(args.block_id, args.agent_id);
    case "add_edge_in_block":
      return addEdgeInBlock(args.block_id, args.from_agent, args.to_agent);
    case "set_schedule":
      return setSchedule(args.preset, args.enabled, args.cron);
    case "restart_cycle":
      return restartCycleFn();
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function handleRequest(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "pipeline-tools", version: "1.0.0" },
        },
      };

    case "notifications/initialized":
      return null; // no response for notifications

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: TOOLS_META },
      };

    case "tools/call": {
      const toolName = params?.name;
      const args = params?.arguments || {};
      const result = handleToolCall(toolName, args);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        },
      };
    }

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

// ============================================================================
// stdio transport
// ============================================================================

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    const response = handleRequest(msg);
    if (response) {
      process.stdout.write(JSON.stringify(response) + "\n");
    }
  } catch (err) {
    process.stderr.write(`MCP parse error: ${err.message}\n`);
  }
});

process.stderr.write(`[pipeline-tools] MCP server started for project: ${PROJECT_ID}\n`);
