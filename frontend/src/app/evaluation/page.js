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
  const cm = benchmark?.confusion_matrix || { tp: 0, tn: 0, fp: 0, fn: 0 };
  const errors = (cm.fp || 0) + (cm.fn || 0);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Chapter 4 Validation"
        title="Benchmark Evaluation"
        description="Deterministic rule baseline scored on a held-out labelled set it was NOT tuned for. The held-out vs in-distribution gap is the honest generalization headroom."
        actions={<Button icon={RotateCw} loading={loading} onClick={fetchBenchmark}>Re-run</Button>}
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
        ) : (
          <>
            <StatCard label="Held-out Accuracy" value={`${benchmark?.accuracy ?? 0}%`} icon={Activity} footer={`${benchmark?.passed_cases ?? 0} of ${benchmark?.total_cases ?? 0} held-out cases correct`} accent={(benchmark?.accuracy ?? 0) >= 80 ? "success" : "warning"} />
            <StatCard label="In-distribution" value={`${benchmark?.in_distribution?.decision_accuracy ?? 0}%`} icon={Target} footer={`${benchmark?.in_distribution?.total_cases ?? 0} cases the rules were tuned for`} />
            <StatCard label="Recall / F1" value={`${benchmark?.recall ?? "–"} / ${benchmark?.f1 ?? "–"}`} icon={Brain} footer="Violation recall & F1 (held-out)" accent="accent" />
            <StatCard label="Errors" value={errors} icon={AlertTriangle} footer={`${cm.fp || 0} false positive · ${cm.fn || 0} missed`} accent={errors > 0 ? "warning" : "success"} />
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
                  <th className="px-4 py-3 font-semibold">XAI Top Terms</th>
                  <th className="px-4 py-3 font-semibold">Result</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((item) => (
                  <tr key={item.id} className="border-t border-zinc-800/60 align-top">
                    <td className="px-4 py-4 min-w-[260px]">
                      <div className="font-semibold text-zinc-200">{item.framework}</div>
                      <div className="text-zinc-500 mt-1 leading-relaxed text-xs">{item.text}</div>
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
                      <div className="flex flex-wrap gap-1">
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
