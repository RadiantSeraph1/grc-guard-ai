"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  FileBarChart, Download, FileText, RotateCw, Sparkles, AlertTriangle,
  CheckCircle2, AlertOctagon
} from "lucide-react";
import { API_BASE_URL } from "../lib/api";

const statusBadge = (s) => ({
  Passing: "text-emerald-400 bg-emerald-950/30 border-emerald-900/50",
  Warning: "text-amber-400 bg-amber-950/30 border-amber-900/50",
  Failing: "text-rose-400 bg-rose-950/30 border-rose-900/50",
}[s] || "text-zinc-400 bg-zinc-900 border-zinc-800");

export default function ReportsPage() {
  const { getToken } = useAuth();
  const [report, setReport] = useState(null);
  const [frameworkId, setFrameworkId] = useState("");
  const [includeAi, setIncludeAi] = useState(false);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const params = new URLSearchParams();
      if (frameworkId) params.set("framework_id", frameworkId);
      if (includeAi) params.set("include_ai", "true");
      const res = await fetch(`${API_BASE_URL}/api/reports/gap-analysis?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReport(await res.json());
      setError(null);
    } catch {
      setReport(null);
      setError("Could not load the report. Check that the backend is running.");
    } finally {
      setLoading(false);
    }
  }, [getToken, frameworkId, includeAi]);

  useEffect(() => { load(); }, [load]);

  const download = async (format) => {
    setDownloading(format);
    try {
      const token = await getToken();
      const params = new URLSearchParams({ format });
      if (frameworkId) params.set("framework_id", frameworkId);
      if (includeAi) params.set("include_ai", "true");
      const res = await fetch(`${API_BASE_URL}/api/reports/export?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gap-analysis${frameworkId ? "-" + frameworkId : ""}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Download failed: ${e.message}`);
    } finally {
      setDownloading(null);
    }
  };

  const frameworks = report?.frameworks || [];

  return (
    <div className="p-6 sm:p-8 max-w-5xl mx-auto space-y-6 pb-24">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100 flex items-center gap-2">
            <FileBarChart size={20} className="text-zinc-400" />
            Compliance Reports
          </h1>
          <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
            Gap analysis across your imported frameworks. Export an audit-ready CSV or PDF.
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 bg-[#121215] border border-zinc-800/80 rounded-xl p-4">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">Framework:</span>
          <select value={frameworkId} onChange={(e) => setFrameworkId(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 px-2.5 py-1.5 focus:outline-none focus:border-zinc-600 cursor-pointer">
            <option value="">All imported</option>
            {frameworks.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
          <input type="checkbox" checked={includeAi} onChange={(e) => setIncludeAi(e.target.checked)} className="accent-zinc-400" />
          <Sparkles size={12} className="text-violet-400" /> AI executive summary
        </label>
        <div className="flex-1" />
        <button onClick={() => download("csv")} disabled={downloading || !report} className="flex items-center gap-1.5 text-xs bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-200 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
          {downloading === "csv" ? <RotateCw size={12} className="animate-spin" /> : <Download size={12} />} CSV
        </button>
        <button onClick={() => download("pdf")} disabled={downloading || !report} className="flex items-center gap-1.5 text-xs bg-zinc-100 hover:bg-white text-zinc-950 font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
          {downloading === "pdf" ? <RotateCw size={12} className="animate-spin" /> : <FileText size={12} />} PDF
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs bg-rose-950/30 border border-rose-900/50 text-rose-300 rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      {report?.executive_summary && (
        <div className="bg-[#121215] border border-zinc-800/80 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5 mb-2"><Sparkles size={12} className="text-violet-400" /> Executive Summary</h3>
          <p className="text-xs text-zinc-400 leading-relaxed">{report.executive_summary}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24 text-zinc-500 text-sm"><RotateCw size={16} className="animate-spin mr-2" /> Building report…</div>
      ) : frameworks.length === 0 ? (
        <div className="text-center py-20 text-zinc-500 text-sm border border-dashed border-zinc-800 rounded-xl">
          No frameworks imported yet. Import one from the <a href="/frameworks" className="text-sky-400 hover:text-sky-300">Frameworks Library</a> to generate a report.
        </div>
      ) : (
        <div className="space-y-5">
          {frameworks.map((fw) => (
            <div key={fw.id} className="bg-[#121215] border border-zinc-800/80 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-zinc-800/60">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-bold text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800 font-mono">{fw.code}</span>
                  <span className="font-medium text-zinc-150 text-sm">{fw.name}</span>
                </div>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-emerald-400">{fw.passing} pass</span>
                  <span className="text-amber-400">{fw.warning} warn</span>
                  <span className="text-rose-400">{fw.failing} fail</span>
                  <span className="font-semibold text-zinc-100">{fw.readiness}%</span>
                </div>
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {fw.controls.map((c) => (
                    <tr key={c.control_code} className="border-b border-zinc-800/40 last:border-0">
                      <td className="px-4 py-2 font-mono text-[10px] text-zinc-500 w-32">{c.control_code}</td>
                      <td className="px-4 py-2 text-zinc-300">{c.title}</td>
                      <td className="px-4 py-2 w-24 text-right">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded border ${statusBadge(c.status)}`}>
                          {c.status === "Passing" ? <CheckCircle2 size={10} /> : c.status === "Failing" ? <AlertOctagon size={10} /> : <AlertTriangle size={10} />}
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {fw.controls.length === 0 && (
                    <tr><td className="px-4 py-3 text-zinc-600 text-center" colSpan={3}>No controls</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
