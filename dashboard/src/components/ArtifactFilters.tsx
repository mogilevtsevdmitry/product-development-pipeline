"use client";

import { useState, useCallback } from "react";
import type { ProjectState } from "@/lib/types";

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
};

interface Props {
  projectId: string;
  agentId: string;
  state: ProjectState;
}

interface DepFilter {
  depId: string;
  depArtifacts: string[];
  allowed: string[] | null;
}

/**
 * Resolve dependency agents for a given agent.
 * Works with both v2 (blocks) and v1 (pipeline_graph.edges).
 */
function getDependencyAgents(agentId: string, state: ProjectState): string[] {
  // First try pipeline_graph edges (v1 or populated v2)
  const edgeDeps = state.pipeline_graph.edges
    .filter((e) => e[1] === agentId)
    .map((e) => e[0]);

  if (edgeDeps.length > 0) return edgeDeps;

  // Fallback: block-based dependencies (v2)
  // Find which block this agent belongs to
  const myBlock = state.blocks?.find((b) => b.agents.includes(agentId));
  if (!myBlock) return [];

  // Collect agents from all blocks this block depends on
  const depAgents: string[] = [];
  for (const depBlockId of myBlock.depends_on || []) {
    const depBlock = state.blocks?.find((b) => b.id === depBlockId);
    if (depBlock) {
      depAgents.push(...depBlock.agents);
    }
  }

  return depAgents;
}

export default function ArtifactFilters({ projectId, agentId, state }: Props) {
  const [saving, setSaving] = useState<string | null>(null);

  const depAgents = getDependencyAgents(agentId, state);
  const artifactFiltersMap = state.artifact_filters || {};

  const filters: DepFilter[] = depAgents
    .map((depId) => {
      const depState = state.agents[depId];
      const depArtifacts = (depState?.artifacts || [])
        .filter((p) =>
          !p.includes("node_modules") &&
          !p.includes("__pycache__") &&
          !p.includes(".next/")
        );

      // Check artifact_filters map first, then pipeline_graph edges
      const filterKey = `${depId}→${agentId}`;
      let allowed: string[] | null = null;

      if (filterKey in artifactFiltersMap) {
        allowed = artifactFiltersMap[filterKey];
      } else {
        // Check edge 3rd element
        const edge = state.pipeline_graph.edges.find(
          (e) => e[0] === depId && e[1] === agentId
        );
        if (edge && edge.length > 2) {
          allowed = edge[2] as string[];
        }
      }

      return { depId, depArtifacts, allowed };
    })
    .filter((f) => f.depArtifacts.length > 0);

  const saveFilter = useCallback(
    async (from: string, artifacts: string[] | null) => {
      setSaving(from);
      try {
        await fetch(
          `/api/state/${encodeURIComponent(projectId)}/artifact-filters`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ from, to: agentId, artifacts }),
          }
        );
      } finally {
        setSaving(null);
      }
    },
    [projectId, agentId]
  );

  const isArtifactAllowed = (
    filter: DepFilter,
    artifactPath: string
  ): boolean => {
    if (filter.allowed === null) return true;
    const fileName = artifactPath.split("/").pop() || artifactPath;
    return filter.allowed.some(
      (a) => fileName === a || artifactPath.endsWith(a)
    );
  };

  const toggleArtifact = (filter: DepFilter, artifactPath: string) => {
    const fileName = artifactPath.split("/").pop() || artifactPath;
    if (filter.allowed === null) {
      const allFileNames = filter.depArtifacts.map(
        (p) => p.split("/").pop() || p
      );
      const newAllowed = allFileNames.filter((f) => f !== fileName);
      saveFilter(filter.depId, newAllowed);
    } else {
      const isCurrentlyAllowed = isArtifactAllowed(filter, artifactPath);
      if (isCurrentlyAllowed) {
        const newAllowed = filter.allowed.filter((a) => a !== fileName);
        saveFilter(filter.depId, newAllowed);
      } else {
        saveFilter(filter.depId, [...filter.allowed, fileName]);
      }
    }
  };

  const togglePassAll = (filter: DepFilter) => {
    if (filter.allowed === null) {
      saveFilter(filter.depId, []);
    } else {
      saveFilter(filter.depId, null);
    }
  };

  if (filters.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
      <h3 className="font-semibold text-white mb-1">Входные артефакты</h3>
      <p className="text-xs text-gray-500 mb-4">
        Выберите какие артефакты зависимостей передавать в промпт агента. Код
        доступен через файловую систему.
      </p>

      <div className="space-y-4">
        {filters.map((filter) => (
          <div
            key={filter.depId}
            className="rounded-lg border border-gray-800 bg-gray-950 p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-300">
                От: {AGENT_LABELS[filter.depId] || filter.depId}
              </span>
              <button
                onClick={() => togglePassAll(filter)}
                disabled={saving === filter.depId}
                className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                  filter.allowed === null
                    ? "bg-blue-600/20 text-blue-400 border border-blue-700/40"
                    : "bg-gray-800 text-gray-500 border border-gray-700 hover:text-gray-300"
                }`}
              >
                {saving === filter.depId
                  ? "..."
                  : filter.allowed === null
                    ? "Передавать всё ✓"
                    : "Передавать всё"}
              </button>
            </div>

            <div className="space-y-1">
              {filter.depArtifacts.map((artifactPath) => {
                const fileName =
                  artifactPath.split("/").pop() || artifactPath;
                const checked = isArtifactAllowed(filter, artifactPath);
                return (
                  <label
                    key={artifactPath}
                    className="flex items-center gap-2.5 py-1.5 px-2 rounded hover:bg-gray-900 cursor-pointer group"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleArtifact(filter, artifactPath)}
                      disabled={saving === filter.depId}
                      className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500/30 focus:ring-offset-0"
                    />
                    <div className="min-w-0">
                      <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
                        📄 {fileName}
                      </span>
                      <span className="text-xs text-gray-600 ml-2 font-mono">
                        {artifactPath}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
