"use client";

import { useEffect, useMemo, useState } from "react";
import { TopHeader, Variation } from "@/components/dashboard/TopHeader";
import { TimelineView } from "@/components/dashboard/TimelineView";
import { CommandView } from "@/components/dashboard/CommandView";
import { NewProjectModal } from "@/components/dashboard/NewProjectModal";
import { mapProject, deriveDecisions, deriveActivity, ProjectSummary } from "@/lib/dashboardModel";

export default function HomePage() {
  const [variation, setVariation] = useState<Variation>("timeline");
  const [raw, setRaw] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? (localStorage.getItem("pp_variation") as Variation | null) : null;
    if (saved === "timeline" || saved === "command") setVariation(saved);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("pp_variation", variation);
  }, [variation]);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.ok ? r.json() : [])
      .then((d) => setRaw(d))
      .catch(() => setRaw([]))
      .finally(() => setLoading(false));
  }, []);

  const projects = useMemo(() => raw.map(mapProject), [raw]);
  const decisions = useMemo(() => deriveDecisions(raw), [raw]);
  const activity = useMemo(() => deriveActivity(raw), [raw]);

  return (
    <>
      <TopHeader variation={variation} setVariation={setVariation} onNew={() => setShowNew(true)} />
      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--text-3)" }}>Загрузка…</div>
      ) : variation === "timeline" ? (
        <TimelineView projects={projects} decisions={decisions} />
      ) : (
        <CommandView projects={projects} decisions={decisions} activity={activity} onNew={() => setShowNew(true)} />
      )}
      <NewProjectModal open={showNew} onClose={() => setShowNew(false)} />
    </>
  );
}
