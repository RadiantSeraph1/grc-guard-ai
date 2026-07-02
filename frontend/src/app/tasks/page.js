"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  ClipboardList, Plus, Trash2, RotateCw, AlertTriangle, CheckCircle2,
  ChevronRight, X
} from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/backend";

const COLUMNS = ["Open", "In Progress", "Blocked", "Done"];
const PRIORITIES = ["Critical", "High", "Medium", "Low"];

const priorityColor = (p) => ({
  Critical: "text-rose-400 border-rose-900/60 bg-rose-950/30",
  High: "text-amber-400 border-amber-900/60 bg-amber-950/30",
  Medium: "text-sky-400 border-sky-900/60 bg-sky-950/30",
  Low: "text-zinc-400 border-zinc-800 bg-zinc-900/40",
}[p] || "text-zinc-400 border-zinc-800 bg-zinc-900/40");

async function fetchJsonOrThrow(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.detail || `Request failed with ${res.status}`);
  return data;
}

const isOverdue = (t) => t.due_date && t.status !== "Done" && t.due_date * 1000 < Date.now();

export default function TasksPage() {
  const { getToken } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", control_code: "", priority: "Medium", due_date: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const data = await fetchJsonOrThrow(`${API_BASE_URL}/api/tasks`, { headers: { Authorization: `Bearer ${token}` } });
      setTasks(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setTasks([]);
      setError("Could not load tasks. Check that the backend is running.");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => { load(); }, [load]);

  const createTask = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const token = await getToken();
      const body = {
        title: form.title.trim(),
        control_code: form.control_code.trim() || null,
        priority: form.priority,
        due_date: form.due_date ? Math.floor(new Date(form.due_date).getTime() / 1000) : null,
      };
      await fetchJsonOrThrow(`${API_BASE_URL}/api/tasks`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setForm({ title: "", control_code: "", priority: "Medium", due_date: "" });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateTask = async (id, patch) => {
    try {
      const token = await getToken();
      await fetchJsonOrThrow(`${API_BASE_URL}/api/tasks/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const deleteTask = async (id) => {
    try {
      const token = await getToken();
      await fetchJsonOrThrow(`${API_BASE_URL}/api/tasks/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  const nextStatus = (s) => COLUMNS[Math.min(COLUMNS.indexOf(s) + 1, COLUMNS.length - 1)];
  const fmtDue = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString() : null);

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto space-y-6 pb-24">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100 flex items-center gap-2">
            <ClipboardList size={20} className="text-zinc-400" />
            Remediation Tasks
          </h1>
          <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
            Track work to fix failing or at-risk controls. Move tasks across stages from Open to Done.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-1.5 text-xs bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors">
            <RotateCw size={12} /> Refresh
          </button>
          <button onClick={() => setShowForm((v) => !v)} className="flex items-center gap-1.5 text-xs bg-zinc-100 hover:bg-white text-zinc-950 font-medium px-3 py-1.5 rounded-lg transition-colors">
            <Plus size={13} /> New task
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs bg-rose-950/30 border border-rose-900/50 text-rose-300 rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      {showForm && (
        <form onSubmit={createTask} className="bg-[#121215] border border-zinc-800/80 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div className="sm:col-span-2">
            <label className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Title</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Enable S3 default encryption" className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 px-2.5 py-2 focus:outline-none focus:border-zinc-600" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Control code (optional)</label>
            <input value={form.control_code} onChange={(e) => setForm({ ...form, control_code: e.target.value })} placeholder="GDPR-PII-01" className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 px-2.5 py-2 focus:outline-none focus:border-zinc-600 font-mono" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Priority</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 px-2 py-2 focus:outline-none focus:border-zinc-600">
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Due</label>
              <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 px-2 py-2 focus:outline-none focus:border-zinc-600" />
            </div>
          </div>
          <div className="sm:col-span-4 flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="text-xs text-zinc-400 hover:text-zinc-200 px-3 py-1.5">Cancel</button>
            <button type="submit" disabled={saving} className="flex items-center gap-1.5 text-xs bg-zinc-100 hover:bg-white text-zinc-950 font-medium px-3 py-1.5 rounded-lg disabled:opacity-50">
              {saving ? <RotateCw size={12} className="animate-spin" /> : <Plus size={12} />} Create
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24 text-zinc-500 text-sm"><RotateCw size={16} className="animate-spin mr-2" /> Loading tasks…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {COLUMNS.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col);
            return (
              <div key={col} className="bg-[#0e0e11] border border-zinc-800/60 rounded-xl p-3 min-h-[200px]">
                <div className="flex items-center justify-between px-1 mb-3">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">{col}</span>
                  <span className="text-[10px] text-zinc-600 bg-zinc-900 rounded-full px-2 py-0.5">{colTasks.length}</span>
                </div>
                <div className="space-y-2">
                  {colTasks.length === 0 && <div className="text-[11px] text-zinc-700 text-center py-6">No tasks</div>}
                  {colTasks.map((t) => (
                    <div key={t.id} className="group bg-[#16161a] border border-zinc-800/80 rounded-lg p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-medium text-zinc-200 leading-snug">{t.title}</span>
                        <button onClick={() => deleteTask(t.id)} className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-rose-400 transition-opacity shrink-0"><Trash2 size={12} /></button>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${priorityColor(t.priority)}`}>{t.priority}</span>
                        {t.control_code && <span className="text-[9px] font-mono text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">{t.control_code}</span>}
                        {t.due_date && (
                          <span className={`text-[9px] ${isOverdue(t) ? "text-rose-400" : "text-zinc-500"}`}>
                            due {fmtDue(t.due_date)}{isOverdue(t) ? " (overdue)" : ""}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <select
                          value={t.status}
                          onChange={(e) => updateTask(t.id, { status: e.target.value })}
                          className="text-[10px] bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 text-zinc-300 focus:outline-none cursor-pointer"
                        >
                          {COLUMNS.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        {t.status !== "Done" && (
                          <button onClick={() => updateTask(t.id, { status: nextStatus(t.status) })} className="text-[10px] text-zinc-400 hover:text-zinc-100 flex items-center gap-0.5">
                            {nextStatus(t.status)} <ChevronRight size={11} />
                          </button>
                        )}
                        {t.status === "Done" && <CheckCircle2 size={13} className="text-emerald-400" />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
