"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Layers, CheckCircle2, PlusCircle, Trash2, RotateCw,
  Zap, FileText, ShieldCheck, AlertTriangle
} from "lucide-react";

import { API_BASE_URL } from "@/app/lib/api";

async function fetchJsonOrThrow(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.detail || `Request failed with ${response.status}`);
  }
  return data;
}

export default function FrameworksPage() {
  const { getToken } = useAuth();
  const [library, setLibrary] = useState([]);
  const [readiness, setReadiness] = useState({}); // id -> {readiness, controls_count}
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}` };

      const lib = await fetchJsonOrThrow(`${API_BASE_URL}/api/frameworks/library`, { headers });
      setLibrary(Array.isArray(lib) ? lib : []);

      // Imported frameworks carry live readiness; merge by id.
      const imported = await fetchJsonOrThrow(`${API_BASE_URL}/api/frameworks`, { headers });
      const map = {};
      (Array.isArray(imported) ? imported : []).forEach((f) => {
        map[f.id] = { readiness: f.readiness ?? 0, controls_count: f.controls_count ?? 0 };
      });
      setReadiness(map);
      setError(null);
    } catch (err) {
      console.warn("Framework library unavailable.", err);
      setLibrary([]);
      setReadiness({});
      setError("Could not load the framework library. Check that the backend is running.");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    load();
  }, [load]);

  const importFramework = async (id, name) => {
    setBusyId(id);
    setNotice(null);
    try {
      const token = await getToken();
      const res = await fetchJsonOrThrow(`${API_BASE_URL}/api/frameworks/import`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ framework_id: id }),
      });
      setNotice(
        `Imported ${name}: ${res.controls_created ?? 0} controls created` +
        (res.controls_linked ? `, ${res.controls_linked} linked` : "") + "."
      );
      await load();
    } catch (err) {
      setError(err.message || `Failed to import ${name}.`);
    } finally {
      setBusyId(null);
    }
  };

  const removeFramework = async (id, name) => {
    setBusyId(id);
    setNotice(null);
    try {
      const token = await getToken();
      await fetchJsonOrThrow(`${API_BASE_URL}/api/frameworks/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotice(`Removed ${name}. Controls shared with other frameworks were kept.`);
      await load();
    } catch (err) {
      setError(err.message || `Failed to remove ${name}.`);
    } finally {
      setBusyId(null);
    }
  };

  const importedCount = library.filter((f) => f.imported).length;

  return (
    <div className="p-6 sm:p-8 max-w-6xl mx-auto space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100 flex items-center gap-2">
            <Layers size={20} className="text-zinc-400" />
            Frameworks Library
          </h1>
          <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
            Import a compliance framework to materialise its controls. Controls auto-tested by
            connectors update their status on each sync; readiness reflects passing control ratios.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-zinc-500">
            {importedCount} of {library.length} imported
          </span>
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-xs bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            <RotateCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {notice && (
        <div className="flex items-start gap-2 text-xs bg-emerald-950/30 border border-emerald-900/50 text-emerald-300 rounded-lg px-3 py-2">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 text-xs bg-rose-950/30 border border-rose-900/50 text-rose-300 rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-24 text-zinc-500 text-sm">
          <RotateCw size={16} className="animate-spin mr-2" /> Loading framework catalog…
        </div>
      ) : library.length === 0 ? (
        <div className="text-center py-24 text-zinc-500 text-sm border border-dashed border-zinc-800 rounded-xl">
          No frameworks available.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {library.map((fw) => {
            const live = readiness[fw.id];
            const isBusy = busyId === fw.id;
            return (
              <div
                key={fw.id}
                className={`bg-[#121215] border rounded-xl p-5 flex flex-col gap-4 transition-colors ${
                  fw.imported ? "border-zinc-700/80" : "border-zinc-800/80"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-bold text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800 font-mono">
                        {fw.code}
                      </span>
                      {fw.imported && (
                        <span className="text-[9px] font-semibold text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 size={10} /> Imported
                        </span>
                      )}
                    </div>
                    <h3 className="font-medium text-zinc-150 text-sm mt-2 truncate">{fw.name}</h3>
                    <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">{fw.description}</p>
                  </div>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-4 text-[11px] text-zinc-400">
                  <span className="flex items-center gap-1.5" title="Total controls in this framework">
                    <FileText size={12} className="text-zinc-500" />
                    {fw.controls_count} controls
                  </span>
                  <span className="flex items-center gap-1.5" title="Controls auto-tested by connectors">
                    <Zap size={12} className="text-amber-500/80" />
                    {fw.automated_controls} automated
                  </span>
                </div>

                {/* Readiness (imported only) */}
                {fw.imported && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-500 flex items-center gap-1">
                        <ShieldCheck size={11} /> Readiness
                      </span>
                      <span className="font-semibold text-zinc-100">{live ? live.readiness : 0}%</span>
                    </div>
                    <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden border border-zinc-800/40">
                      <div
                        className="bg-zinc-100 h-full rounded-full transition-all duration-700"
                        style={{ width: `${live ? live.readiness : 0}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Action */}
                <div className="pt-1">
                  {fw.imported ? (
                    <button
                      onClick={() => removeFramework(fw.id, fw.name)}
                      disabled={isBusy}
                      className="flex items-center justify-center gap-1.5 w-full text-xs bg-zinc-900 hover:bg-rose-950/40 hover:text-rose-300 border border-zinc-800 hover:border-rose-900/60 text-zinc-400 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isBusy ? <RotateCw size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      Remove framework
                    </button>
                  ) : (
                    <button
                      onClick={() => importFramework(fw.id, fw.name)}
                      disabled={isBusy}
                      className="flex items-center justify-center gap-1.5 w-full text-xs bg-zinc-100 hover:bg-white text-zinc-950 font-medium px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isBusy ? <RotateCw size={12} className="animate-spin" /> : <PlusCircle size={12} />}
                      Import framework
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
