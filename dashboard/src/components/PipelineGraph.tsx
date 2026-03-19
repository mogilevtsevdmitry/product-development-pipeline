"use client";

import { useMemo, useCallback } from "react";
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

// Simple dagre-like layout: group nodes by phase, then position horizontally
function layoutNodes(
  graph: PipelineGraphType,
  agents: Record<string, AgentState>
): { nodes: Node[]; edges: Edge[] } {
  const phaseOrder = [
    "discovery",
    "analysis",
    "gate",
    "strategy",
    "design",
    "validation",
  ];

  // Group nodes by phase
  const phaseGroups: Record<string, typeof graph.nodes> = {};
  for (const node of graph.nodes) {
    const phase = node.phase || "other";
    if (!phaseGroups[phase]) phaseGroups[phase] = [];
    phaseGroups[phase].push(node);
  }

  // Sort phases
  const sortedPhases = Object.keys(phaseGroups).sort((a, b) => {
    const ai = phaseOrder.indexOf(a);
    const bi = phaseOrder.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const X_GAP = 280;
  const Y_GAP = 100;

  const flowNodes: Node[] = [];

  sortedPhases.forEach((phase, colIdx) => {
    const group = phaseGroups[phase];
    const totalHeight = group.length * Y_GAP;
    const startY = -totalHeight / 2 + Y_GAP / 2;

    group.forEach((node, rowIdx) => {
      const agentState = agents[node.id];
      const status = agentState?.status ?? "pending";

      flowNodes.push({
        id: node.id,
        type: "agent",
        position: { x: colIdx * X_GAP, y: startY + rowIdx * Y_GAP },
        data: {
          label: node.label,
          phase: node.phase,
          status,
          type: node.type || "agent",
        },
      });
    });
  });

  const flowEdges: Edge[] = graph.edges.map((edge, i) => ({
    id: `e-${i}-${edge.source}-${edge.target}`,
    source: edge.source,
    target: edge.target,
    animated: agents[edge.source]?.status === "running",
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

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => layoutNodes(graph, agents),
    [graph, agents]
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const data = node.data as Record<string, unknown>;
      if (data.type !== "gate") {
        router.push(`/project/${projectId}/agent/${node.id}`);
      }
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
