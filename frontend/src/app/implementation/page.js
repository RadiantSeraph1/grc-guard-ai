"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { CheckCircle, CircleDashed, FileText, ShieldCheck, Database, Plug, AlertTriangle } from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/backend";

export default function ImplementationPage() {
  const { getToken } = useAuth();
  const [report, setReport] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE_URL}/api/evaluation/report`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setReport(await res.json());
      } catch (err) {
        setReport(null);
      }
    };
    load();
  }, []);

  const objectives = report?.objectives || [];

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto w-full">
      <div>
        <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">PDF Implementation Closure</span>
        <h2 className="text-2xl font-semibold text-zinc-100 tracking-tight mt-0.5">Final Project Report</h2>
        <p className="text-zinc-400 text-xs mt-0.5 max-w-2xl">
          A practical implementation-readiness view showing how the app maps to the report aim: banking GRC automation with LLMs, explainability, BYOK, and live system evidence.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard icon={ShieldCheck} label="Completion" value={`${report?.overall_completion ?? 0}%`} sub={report?.implementation_level || "Loading"} />
        <SummaryCard icon={Database} label="Controls" value={String(report?.controls_count ?? 0)} sub={`${report?.risks_count ?? 0} risks mapped`} />
        <SummaryCard icon={CircleDashed} label="Departments" value={String(report?.departments?.length ?? 0)} sub={(report?.departments || []).join(", ")} />
        <SummaryCard icon={Plug} label="Connectors" value={String(report?.integrations?.length ?? 0)} sub="AWS, GitHub, Okta, Auth0, Jamf, Workday" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#121215] border border-zinc-800/80 rounded-xl p-5 space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Objective Coverage</h3>
            <p className="text-[10px] text-zinc-500 mt-1">Mapped from the PDF aim and objectives.</p>
          </div>
          {objectives.map((item) => (
            <div key={item.name} className="border border-zinc-850 rounded-lg p-4 bg-zinc-950/30">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <CheckCircle size={14} className={item.coverage >= 70 ? "text-emerald-400" : "text-amber-400"} />
                    <h4 className="text-xs font-semibold text-zinc-100">{item.name}</h4>
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-1">{item.status}</p>
                </div>
                <span className="text-xs font-semibold text-zinc-200">{item.coverage}%</span>
              </div>
              <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden mt-3">
                <div className="h-full bg-zinc-100" style={{ width: `${item.coverage}%` }} />
              </div>
              <p className="text-[11px] text-zinc-400 mt-3 leading-relaxed">{item.evidence}</p>
            </div>
          ))}
        </div>

        <div className="space-y-6">
          <div className="bg-[#121215] border border-zinc-800/80 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <AlertTriangle size={15} className="text-amber-400" />
              Remaining Gaps
            </h3>
            <div className="space-y-3 mt-4">
              {(report?.remaining_gaps || []).map((gap) => (
                <div key={gap} className="text-[11px] text-zinc-400 leading-relaxed border-b border-zinc-850 pb-3 last:border-0 last:pb-0">
                  {gap}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#121215] border border-zinc-800/80 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <FileText size={15} className="text-zinc-400" />
              Demo Script
            </h3>
            <div className="space-y-3 mt-4">
              {(report?.demo_script || []).map((step, index) => (
                <div key={step} className="flex gap-3 text-[11px] text-zinc-400 leading-relaxed">
                  <span className="w-5 h-5 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 flex items-center justify-center text-[10px] shrink-0">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="bg-[#121215] border border-zinc-800/80 rounded-xl p-5 min-h-[124px]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{label}</span>
        <Icon size={16} className="text-zinc-500" />
      </div>
      <div className="text-2xl font-semibold text-zinc-100 mt-3">{value}</div>
      <div className="text-[10px] text-zinc-500 mt-2 line-clamp-2">{sub}</div>
    </div>
  );
}
