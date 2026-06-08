"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Activity, CheckCircle, XCircle, RotateCw, Target, Brain, AlertTriangle } from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/backend";

export default function EvaluationPage() {
  const { getToken } = useAuth();
  const [benchmark, setBenchmark] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchBenchmark = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/evaluation/benchmark`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBenchmark(await res.json());
    } catch (err) {
      setBenchmark({
        company: "ARB Apex Bank",
        total_cases: 6,
        passed_cases: 0,
        accuracy: 0,
        target_accuracy: 85,
        workload_reduction_estimate: 0,
        summary: "Benchmark service unavailable.",
        results: []
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBenchmark();
  }, []);

  const cases = benchmark?.results || [];

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto w-full">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Chapter 4 Validation</span>
          <h2 className="text-2xl font-semibold text-zinc-100 tracking-tight mt-0.5">Benchmark Evaluation</h2>
          <p className="text-zinc-400 text-xs mt-0.5 max-w-2xl">
            Expected-vs-actual banking compliance tests mapped to the project report objectives: Basel III, CBEST, GDPR, SOC 2, XAI, and BYOK/API security.
          </p>
        </div>
        <button
          onClick={fetchBenchmark}
          className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-200 rounded-lg px-3 py-2 text-xs flex items-center gap-2"
        >
          <RotateCw size={13} className={loading ? "animate-spin" : ""} />
          Re-run
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard icon={Activity} label="Accuracy" value={`${benchmark?.accuracy ?? 0}%`} sub={`${benchmark?.passed_cases ?? 0} of ${benchmark?.total_cases ?? 0} cases passed`} />
        <MetricCard icon={Target} label="Target" value={`${benchmark?.target_accuracy ?? 85}%`} sub="Demo acceptance threshold" />
        <MetricCard icon={Brain} label="Workload Reduction" value={`${benchmark?.workload_reduction_estimate ?? 0}%`} sub="Report-aligned estimate" />
        <MetricCard icon={AlertTriangle} label="Misclass Types" value={String(new Set(cases.map((item) => item.misclassification_type)).size)} sub="Tracked failure categories" />
      </div>

      <div className="bg-[#121215] border border-zinc-800/80 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-zinc-850">
          <h3 className="text-sm font-semibold text-zinc-100">Regulatory Test Matrix</h3>
          <p className="text-[10px] text-zinc-500 mt-1">{benchmark?.summary}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-950/60 text-[10px] uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3">Case</th>
                <th className="px-4 py-3">Expected</th>
                <th className="px-4 py-3">Actual</th>
                <th className="px-4 py-3">Misclassification Guard</th>
                <th className="px-4 py-3">Result</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-zinc-500">Running benchmark...</td></tr>
              ) : cases.map((item) => (
                <tr key={item.id} className="border-t border-zinc-850/70 align-top">
                  <td className="px-4 py-4 min-w-[260px]">
                    <div className="font-semibold text-zinc-200">{item.framework}</div>
                    <div className="text-zinc-500 mt-1 leading-relaxed">{item.text}</div>
                    <div className="text-[10px] text-zinc-600 mt-2">Objective: {item.objective}</div>
                  </td>
                  <td className="px-4 py-4 text-zinc-300">
                    <div>{item.expected_decision}</div>
                    <div className="text-zinc-500 mt-1">{item.expected_category}</div>
                  </td>
                  <td className="px-4 py-4 text-zinc-300">
                    <div>{item.actual_decision}</div>
                    <div className="text-zinc-500 mt-1">{item.actual_category}</div>
                    <div className="text-[10px] text-zinc-600 mt-2">Confidence: {Math.round((item.confidence || 0) * 100)}%</div>
                  </td>
                  <td className="px-4 py-4 text-zinc-400 max-w-[260px]">
                    <div>{item.misclassification_type}</div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {(item.top_terms || []).slice(0, 5).map((term, idx) => (
                        <span key={idx} className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-[10px] text-zinc-400">
                          {term.word}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    {item.passed ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-1 text-[10px] font-semibold">
                        <CheckCircle size={12} /> PASS
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded px-2 py-1 text-[10px] font-semibold">
                        <XCircle size={12} /> FAIL
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="bg-[#121215] border border-zinc-800/80 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{label}</span>
        <Icon size={16} className="text-zinc-500" />
      </div>
      <div className="text-2xl font-semibold text-zinc-100 mt-3">{value}</div>
      <div className="text-[10px] text-zinc-500 mt-2">{sub}</div>
    </div>
  );
}
