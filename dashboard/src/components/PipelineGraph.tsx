"use client";

import { useMemo, useCallback, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRouter } from "next/navigation";
import AgentNodeComponent from "./AgentNode";
import type { PipelineGraph as PipelineGraphType, AgentState } from "@/lib/types";

interface PipelineGraphProps {
  graph: PipelineGraphType;
  agents: Record<string, AgentState>;
  projectId: string;
}

const nodeTypes = { agent: AgentNodeComponent };

// Agent display names
const AGENT_LABELS: Record<string, string> = {
  "problem-researcher": "Problem Researcher",
  "market-researcher": "Market Researcher",
  "product-owner": "Product Owner",
  "pipeline-architect": "Pipeline Architect",
  "business-analyst": "Business Analyst",
  "legal-compliance": "Legal / Compliance",
  "ux-ui-designer": "UX/UI Designer",
  "system-architect": "System Architect",
  "tech-lead": "Tech Lead",
  "backend-developer": "Backend Developer",
  "frontend-developer": "Frontend Developer",
  "devops-engineer": "DevOps Engineer",
  "qa-engineer": "QA Engineer",
  "security-engineer": "Security Engineer",
  "release-manager": "Release Manager",
  "product-marketer": "Product Marketer",
  "smm-manager": "SMM Manager",
  "content-creator": "Content Creator",
  "customer-support": "Customer Support",
  "data-analyst": "Data Analyst",
  orchestrator: "Orchestrator",
};

// Agent phase mapping
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

const PHASE_ORDER = [
  "research",
  "product",
  "meta",
  "legal",
  "design",
  "development",
  "quality",
  "release",
  "marketing",
  "feedback",
];

/**
 * Topological sort + column assignment based on dependency depth.
 * Nodes at the same depth go in the same column.
 */
function layoutNodes(
  graph: PipelineGraphType,
  agents: Record<string, AgentState>
): { nodes: Node[]; edges: Edge[] } {
  const nodeIds = graph.nodes; // string[]
  const edgePairs = graph.edges; // [string, string][]

  // Build adjacency: incoming edges per node
  const incomingMap: Record<string, string[]> = {};
  for (const id of nodeIds) incomingMap[id] = [];
  for (const [src, tgt] of edgePairs) {
    if (incomingMap[tgt]) incomingMap[tgt].push(src);
  }

  // Compute depth (longest path from root)
  const depth: Record<string, number> = {};
  function getDepth(id: string): number {
    if (depth[id] !== undefined) return depth[id];
    const deps = incomingMap[id] || [];
    if (deps.length === 0) {
      depth[id] = 0;
    } else {
      depth[id] = Math.max(...deps.map(getDepth)) + 1;
    }
    return depth[id];
  }
  for (const id of nodeIds) getDepth(id);

  // Group by depth (column)
  const columns: Record<number, string[]> = {};
  for (const id of nodeIds) {
    const d = depth[id];
    if (!columns[d]) columns[d] = [];
    columns[d].push(id);
  }

  // Sort within column by phase order for consistency
  for (const col of Object.values(columns)) {
    col.sort((a, b) => {
      const pa = PHASE_ORDER.indexOf(AGENT_PHASES[a] || "");
      const pb = PHASE_ORDER.indexOf(AGENT_PHASES[b] || "");
      return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
    });
  }

  const X_GAP = 260;
  const Y_GAP = 90;

  const flowNodes: Node[] = [];
  const sortedCols = Object.keys(columns)
    .map(Number)
    .sort((a, b) => a - b);

  for (const colIdx of sortedCols) {
    const col = columns[colIdx];
    const totalHeight = col.length * Y_GAP;
    const startY = -totalHeight / 2 + Y_GAP / 2;

    for (let rowIdx = 0; rowIdx < col.length; rowIdx++) {
      const id = col[rowIdx];
      const status = agents[id]?.status ?? "pending";

      flowNodes.push({
        id,
        type: "agent",
        position: { x: colIdx * X_GAP, y: startY + rowIdx * Y_GAP },
        data: {
          label: AGENT_LABELS[id] || id,
          phase: AGENT_PHASES[id] || "other",
          status,
        },
      });
    }
  }

  const flowEdges: Edge[] = edgePairs.map(([source, target], i) => ({
    id: `e-${i}-${source}-${target}`,
    source,
    target,
    animated: agents[source]?.status === "running",
    style: { stroke: "#4b5563", strokeWidth: 2 },
  }));

  return { nodes: flowNodes, edges: flowEdges };
}

export default function PipelineGraph({
  graph,
  agents,
  projectId,
}: PipelineGraphProps) {
  const router = useRouter();

  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(
    () => layoutNodes(graph, agents),
    [graph, agents]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  // Sync when data changes (polling updates)
  useEffect(() => {
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      router.push(`/project/${projectId}/agent/${node.id}`);
    },
    [router, projectId]
  );

  return (
    <div className="w-full h-[600px] rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1f2937" />
        <Controls
          showInteractive={false}
          className="!bg-gray-800 !border-gray-700 !rounded-lg !shadow-xl"
        />
        <MiniMap
          nodeColor={(node) => {
            const data = node.data as Record<string, unknown>;
            const status = data.status as string;
            switch (status) {
              case "completed":
                return "#10b981";
              case "running":
                return "#3b82f6";
              case "failed":
                return "#ef4444";
              case "skipped":
                return "#6b7280";
              default:
                return "#374151";
            }
          }}
          maskColor="rgba(0, 0, 0, 0.7)"
          className="!bg-gray-900 !border-gray-700"
        />
      </ReactFlow>
    </div>
  );
}
