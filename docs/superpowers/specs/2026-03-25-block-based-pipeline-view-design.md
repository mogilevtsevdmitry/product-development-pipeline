# Block-Based Pipeline View

## Summary

Переход от плоского DAG-графа к блочной структуре пайплайна. Блоки группируют агентов по логическим этапам (Исследование, Дизайн, Разработка и т.д.). UI: sidebar с блоками слева + основная область с мини-графом агентов блока справа. Блоки кастомизируемые — можно создавать, удалять, менять порядок, добавлять агентов.

## Motivation

Текущий вид — единый ReactFlow граф с 21 агентом — не даёт чёткого понимания этапов работы. Нет визуальной группировки, нет явного разделения на фазы. Пользователь не видит "большую картину" прогресса.

## Data Model

### PipelineBlock

```typescript
interface PipelineBlock {
  id: string                    // "research", "custom-block-1"
  name: string                  // "Исследование"
  description?: string          // описание задачи блока
  agents: string[]              // ["problem-researcher", "market-researcher"]
  edges: [string, string][]     // внутренние зависимости агентов блока
  requires_approval: boolean    // gate: нужен ли approval после завершения
  approval?: {                  // заполняется при принятии решения
    decision: "go" | "stop"
    decided_by: string
    timestamp: string
    notes?: string
  }
}
```

### ProjectState changes

```typescript
interface ProjectState {
  project_id: string
  name: string
  description: string
  project_path?: string
  created_at: string
  updated_at: string
  mode: PipelineMode            // "auto" | "human_approval"
  status: ProjectStatus
  blocks: PipelineBlock[]       // NEW — replaces pipeline_graph + gate_decisions
  agents: Record<string, AgentState>  // unchanged
  schema_version: 2             // bumped from 1
}
```

Removed fields:
- `pipeline_graph` — replaced by `blocks`
- `gate_decisions` — moved into `block.approval`
- `current_gate` — computed from blocks

### Block Status (computed, not stored)

Derived from agent statuses within the block:

| Status | Condition |
|--------|-----------|
| `completed` | All agents completed or skipped |
| `running` | At least one agent running |
| `pending` | All agents pending, previous block completed+approved |
| `blocked` | Previous block not completed or awaiting approval |
| `awaiting_approval` | All agents completed, requires_approval=true, no approval |
| `failed` | At least one agent failed |

### Block Dependencies

Linear — array order in `blocks[]`. Block N depends on block N-1.

Block can start when:
1. Previous block status = `completed`
2. If previous block `requires_approval` — its `approval.decision === "go"`

First block has no dependencies (always startable).

### Default Blocks

When creating a new project, use these default blocks (replacing the old 10 phases):

| Block | Agents | requires_approval |
|-------|--------|-------------------|
| Исследование | problem-researcher, market-researcher, product-owner, business-analyst | true |
| Юридическое | legal-compliance | false |
| Дизайн | ux-ui-designer | false |
| Архитектура и разработка | pipeline-architect, system-architect, tech-lead, backend-developer, frontend-developer, devops-engineer | true |
| Тестирование | qa-engineer, security-engineer | true |
| Релиз | release-manager | false |
| Маркетинг | product-marketer, smm-manager, content-creator | false |
| Фидбек | customer-support, data-analyst | false |

### Migration (schema_version 1 → 2)

Automatic on state load:
1. Group agents from `pipeline_graph.nodes` into default blocks by phase
2. Transfer `gate_decisions` to corresponding block.approval
3. Remove `pipeline_graph`, `gate_decisions`, `current_gate`
4. Set `schema_version: 2`

## UI Design

### Layout

```
┌──────────────────────────────────────────────────────┐
│  Header: Project Name / Controls                     │
├────────────┬─────────────────────────────────────────┤
│            │                                         │
│  Sidebar   │  Main Area                              │
│  ~280px    │                                         │
│            │  Block Title + Description               │
│  [Block 1] │                                         │
│  ████░░ 3/5│  ┌─────────────────────────────────┐   │
│            │  │  ReactFlow mini-graph            │   │
│  [Block 2] │  │  (agents within selected block)  │   │
│  🔒 blocked│  │                                   │   │
│            │  └─────────────────────────────────┘   │
│  [Block 3] │                                         │
│  ░░░░░ 0/2│  Block Stats: agents, cost, tokens      │
│            │                                         │
│  [+ Block] │  [Gate Panel if awaiting_approval]      │
│            │                                         │
├────────────┴─────────────────────────────────────────┤
│  Footer stats: total progress, cost, tokens          │
└──────────────────────────────────────────────────────┘
```

### Sidebar

- Dark background (gray-900/950), fixed width ~280px
- Each block is a row:
  - Status icon: ✅ completed, 🔵 running (pulsing), ⏳ pending, 🔒 blocked, ⚠️ awaiting_approval, ❌ failed
  - Block name
  - Progress bar: filled portion = completed agents / total agents
  - Format: "3/5" text next to bar
- Blocked blocks: grayed out, lock icon, tooltip "Ожидает завершения [block name]"
- Active/selected block: highlighted background or left border accent
- Hover: edit (pencil) and delete (trash) icons appear
- Bottom: "+" button to add new block
- Drag-and-drop to reorder blocks (changes dependency order)

### Main Area

When a block is selected:
1. **Header**: Block name (editable on click) + description
2. **Status banner** (conditional):
   - `blocked`: "Ожидает завершения блока «[name]»"
   - `awaiting_approval`: GatePanel with Go/Stop buttons + notes textarea
3. **Mini ReactFlow graph**: agents within this block, using existing AgentNode component
   - Same hover controls (play/pause/restart/remove)
   - Same status styling
   - Edges from block.edges
4. **Block stats**: agents completed, total cost, tokens used

When no block selected (initial state): show overview — all blocks as cards with summary stats.

### Block Editor

- **Add block**: "+" button in sidebar → inline form or modal:
  - Name (required)
  - Description (optional)
  - requires_approval checkbox (default: true)
- **Add agent to block**: Button in main area → dropdown/modal selecting from agent catalog (agents not yet in any block)
- **Remove agent**: Hover control on AgentNode → "Remove from block"
- **Edit block**: Pencil icon → edit name, description, requires_approval inline
- **Delete block**: Trash icon → confirmation → agents become unassigned
- **Reorder blocks**: Drag-and-drop in sidebar
- **Agent edges**: Drag connections between agent nodes in the mini-graph

## Orchestrator Changes

### engine.py

Replace flat graph iteration with block-based iteration:

```python
def run_pipeline():
    for block in state["blocks"]:
        block_status = compute_block_status(block, state["agents"])

        if block_status == "blocked":
            break  # can't proceed past blocked block

        if block_status == "awaiting_approval":
            state["status"] = "paused_at_gate"
            break  # wait for human decision

        if block_status in ("completed",):
            continue  # move to next block

        if block_status in ("pending", "running", "failed"):
            # Run ready agents within this block
            ready = find_ready_agents_in_block(block, state["agents"])
            for agent_id in ready:
                run_agent(agent_id)
            break  # don't advance to next block until this one completes
```

### pipeline_builder.py

`build_pipeline()` returns `blocks[]` instead of `pipeline_graph`.
`DEFAULT_FULL_GRAPH` replaced with `DEFAULT_BLOCKS`.

### gates.py

Simplified — gate logic moves into block approval:
- `check_gate()` → check if any block is `awaiting_approval`
- `resolve_gate(block_id, decision, notes)` → set `block.approval`
- Remove hardcoded gate types (gate_1_build, etc.)

### config.py

- `PHASES` replaced with `DEFAULT_BLOCKS` configuration
- `GATE_DECISIONS` simplified to `["go", "stop"]`
- `get_agent_phase()` replaced with `get_agent_block()`

## API Changes

### GET /api/state/[id]

Response now includes `blocks[]` instead of `pipeline_graph`.

### POST /api/state/[id]

New/changed actions:
- `action: "gate_decision"` → `{ block_id, decision: "go"|"stop", notes? }`
- `action: "add_block"` → `{ name, description?, requires_approval?, after_block_id? }`
- `action: "remove_block"` → `{ block_id }`
- `action: "update_block"` → `{ block_id, name?, description?, requires_approval? }`
- `action: "reorder_blocks"` → `{ block_ids: string[] }` (new order)
- `action: "add_agent_to_block"` → `{ block_id, agent_id }`
- `action: "remove_agent_from_block"` → `{ block_id, agent_id }`
- `action: "add_edge_in_block"` → `{ block_id, from_agent, to_agent }`
- `action: "remove_edge_in_block"` → `{ block_id, from_agent, to_agent }`

Existing agent-level actions (restart_agent, run_agent, etc.) remain unchanged.

## Components

### New Components

- `BlockSidebar.tsx` — sidebar with block list, progress bars, drag-and-drop
- `BlockView.tsx` — main area content for selected block
- `BlockEditor.tsx` — inline/modal editor for creating/editing blocks
- `BlockGatePanel.tsx` — simplified gate panel for block approval (Go/Stop)

### Modified Components

- `PipelineGraph.tsx` → scoped to show only agents within a block
- `AgentNode.tsx` → unchanged (works as-is within block mini-graph)
- Project detail page → new layout with sidebar + main area

### Removed Components

- `GatePanel.tsx` → replaced by `BlockGatePanel.tsx` (simpler: only go/stop)

## File Changes Summary

### Orchestrator (Python)
- `orchestrator/config.py` — DEFAULT_BLOCKS, simplified gates
- `orchestrator/engine.py` — block-based iteration
- `orchestrator/pipeline_builder.py` — returns blocks[]
- `orchestrator/gates.py` — simplified to block approval

### Dashboard (TypeScript)
- `dashboard/src/lib/types.ts` — PipelineBlock type, updated ProjectState
- `dashboard/src/lib/state.ts` — migration logic, block CRUD, new gate logic
- `dashboard/src/app/project/[id]/page.tsx` — new sidebar+main layout
- `dashboard/src/components/BlockSidebar.tsx` — NEW
- `dashboard/src/components/BlockView.tsx` — NEW
- `dashboard/src/components/BlockEditor.tsx` — NEW
- `dashboard/src/components/BlockGatePanel.tsx` — NEW
- `dashboard/src/components/PipelineGraph.tsx` — scoped to block agents
- `dashboard/src/app/api/state/[id]/route.ts` — new block actions
