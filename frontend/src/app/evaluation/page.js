"use client";

import { useEffect, useState, useCallback } from "react";
import { Activity, CheckCircle, XCircle, RotateCw, Target, Brain, AlertTriangle } from "lucide-react";
import { useApi } from "../lib/api";
import { PageContainer, PageHeader, Card, StatCard, Button, Badge, Skeleton, EmptyState } from "../components/ui";

export default function EvaluationPage() {
  const api = useApi();
  const [benchmark, setBenchmark] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchBenchmark = useCallback(async () => {
    setLoading(true);
    try {
      setBenchmark(await api.get("/api/evaluation/benchmark"));
    } catch {
      setBenchmark(null);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchBenchmark();
  }, [fetchBenchmark]);

  const cases = benchmark?.results || [];
  const misclassTypes = new Set(cases.map((item) => item.misclassification_type)).size;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Chapter 4 Validation"
        title="Benchmark Evaluation"
        description="Expected-vs-actual banking compliance tests mapped to report objectives: Basel III, CBEST, GDPR, SOC 2, XAI, and BYOK/API security."
        actions={<Button icon={RotateCw} loading={loading} onClick={fetchBenchmark}>Re-run</Button>}
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
        ) : (
          <>
            <StatCard label="Accuracy" value={`${benchmark?.accuracy ?? 0}%`} icon={Activity} footer={`${benchmark?.passed_cases ?? 0} of ${benchmark?.total_cases ?? 0} cases passed`} accent={(benchmark?.accuracy ?? 0) >= (benchmark?.target_accuracy ?? 85) ? "success" : "warning"} />
            <StatCard label="Target" value={`${benchmark?.target_accuracy ?? 85}%`} icon={Target} footer="Acceptance threshold" />
            <StatCard label="Workload Reduction" value={`${benchmark?.workload_reduction_estimate ?? 0}%`} icon={Brain} footer="Report-aligned estimate" accent="accent" />
            <StatCard label="Misclass Types" value={misclassTypes} icon={AlertTriangle} footer="Tracked failure categories" />
          </>
        )}
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="p-5 border-b border-zinc-800/60">
          <h3 className="text-sm font-semibold text-zinc-100">Regulatory Test Matrix</h3>
          <p className="text-xs text-zinc-500 mt-1">{benchmark?.summary || "Benchmark results across regulatory test cases."}</p>
        </div>
        {loading ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : cases.length === 0 ? (
          <EmptyState icon={Activity} title="No benchmark results" description="Run the benchmark to populate the regulatory test matrix." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-900/40 text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Case</th>
                  <th className="px-4 py-3 font-semibold">Expected</th>
                  <th className="px-4 py-3 font-semibold">Actual</th>
                  <th className="px-4 py-3 font-semibold">Misclassification Guard</th>
                  <th className="px-4 py-3 font-semibold">Result</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((item) => (
                  <tr key={item.id} className="border-t border-zinc-800/60 align-top">
                    <td className="px-4 py-4 min-w-[260px]">
                      <div className="font-semibold text-zinc-200">{item.framework}</div>
                      <div className="text-zinc-500 mt-1 leading-relaxed text-xs">{item.text}</div>
                      <div className="text-xs text-zinc-600 mt-2">Objective: {item.objective}</div>
                    </td>
                    <td className="px-4 py-4 text-zinc-300">
                      <div>{item.expected_decision}</div>
                      <div className="text-zinc-500 mt-1 text-xs">{item.expected_category}</div>
                    </td>
                    <td className="px-4 py-4 text-zinc-300">
                      <div>{item.actual_decision}</div>
                      <div className="text-zinc-500 mt-1 text-xs">{item.actual_category}</div>
                      <div className="text-xs text-zinc-600 mt-2">Confidence: {Math.round((item.confidence || 0) * 100)}%</div>
                    </td>
                    <td className="px-4 py-4 text-zinc-400 max-w-[260px]">
                      <div className="text-xs">{item.misclassification_type}</div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {(item.top_terms || []).slice(0, 5).map((term, idx) => (
                          <span key={idx} className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-xs text-zinc-400">{term.word}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <Badge variant={item.passed ? "success" : "danger"}>
                        {item.passed ? <><CheckCircle size={12} /> PASS</> : <><XCircle size={12} /> FAIL</>}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageContainer>
  );
}
