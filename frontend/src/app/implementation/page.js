"use client";

import { useEffect, useState, useCallback } from "react";
import { CheckCircle, CircleDashed, FileText, ShieldCheck, Database, Plug, AlertTriangle } from "lucide-react";
import { useApi } from "../lib/api";
import { PageContainer, PageHeader, Card, CardHeader, StatCard, Skeleton, EmptyState, ProgressBar } from "../components/ui";

export default function ImplementationPage() {
  const api = useApi();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setReport(await api.get("/api/evaluation/report"));
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const objectives = report?.objectives || [];
  const integrations = report?.integrations || [];

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Project Status"
        title="Final Project Report"
        description="Implementation-readiness view mapping the app to the report aim: banking GRC automation with LLMs, explainability, BYOK, and live system evidence."
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
        ) : (
          <>
            <StatCard label="Completion" value={`${report?.overall_completion ?? 0}%`} icon={ShieldCheck} footer={report?.implementation_level || "—"} accent={(report?.overall_completion ?? 0) >= 70 ? "success" : "warning"} />
            <StatCard label="Controls" value={report?.controls_count ?? 0} icon={Database} footer={`${report?.risks_count ?? 0} risks mapped`} />
            <StatCard label="Departments" value={report?.departments?.length ?? 0} icon={CircleDashed} footer={(report?.departments || []).join(", ") || "None"} />
            <StatCard label="Connectors" value={integrations.length} icon={Plug} footer={integrations.length ? integrations.slice(0, 6).map((i) => i.name).join(", ") : "None connected"} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 space-y-4">
          <CardHeader title="Objective Coverage" description="Mapped from the PDF aim and objectives." />
          {loading ? (
            <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
          ) : objectives.length === 0 ? (
            <EmptyState icon={FileText} title="Report unavailable" description="The implementation report could not be loaded." />
          ) : (
            objectives.map((item) => (
              <div key={item.name} className="border border-zinc-800 rounded-lg p-4 bg-zinc-950/30">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <CheckCircle size={14} className={item.coverage >= 70 ? "text-emerald-400" : "text-amber-400"} />
                      <h4 className="text-sm font-semibold text-zinc-100">{item.name}</h4>
                    </div>
                    <p className="text-xs text-zinc-500 mt-1">{item.status}</p>
                  </div>
                  <span className="text-sm font-semibold text-zinc-200 tabular-nums">{item.coverage}%</span>
                </div>
                <ProgressBar value={item.coverage} tone={item.coverage >= 70 ? "success" : "warning"} className="mt-3" />
                <p className="text-xs text-zinc-400 mt-3 leading-relaxed">{item.evidence}</p>
              </div>
            ))
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <AlertTriangle size={15} className="text-amber-400" /> Remaining Gaps
            </h3>
            <div className="space-y-3 mt-4">
              {(report?.remaining_gaps || []).length === 0 ? (
                <p className="text-xs text-zinc-500">No gaps reported.</p>
              ) : (
                (report?.remaining_gaps || []).map((gap) => (
                  <div key={gap} className="text-xs text-zinc-400 leading-relaxed border-b border-zinc-800 pb-3 last:border-0 last:pb-0">{gap}</div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}
