"use client";

import { useState, useEffect } from "react";
import { useUser, useAuth } from "@clerk/nextjs";
import {
  ShieldCheck, AlertTriangle, RotateCw, CheckCircle2,
  AlertOctagon, HelpCircle, ArrowUpRight, ArrowRight, Activity, Globe,
  TrendingUp, TrendingDown, Minus
} from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/backend";

const DEFAULT_STATS = {
  compliance_score: 0,
  average_residual_risk: 0,
  failed_controls_count: 0,
  warning_controls_count: 0,
  passing_controls_count: 0,
  total_controls_count: 0,
  active_integrations: 0,
  total_integrations: 0,
  days_until_next_audit: 0
};

async function fetchJsonOrThrow(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.detail || `Request failed with ${response.status}`);
  }
  return data;
}

export default function DashboardPage() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const [stats, setStats] = useState(DEFAULT_STATS);
  
  const [frameworks, setFrameworks] = useState([]);
  const [integrations, setIntegrations] = useState([]);
  const [activities, setActivities] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [drift, setDrift] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const fetchDashboardData = async () => {
    try {
      const token = await getToken();
      const headers = { "Authorization": `Bearer ${token}` };
      
      const statsData = await fetchJsonOrThrow(`${API_BASE_URL}/api/dashboard/stats`, { headers });
      setStats({ ...DEFAULT_STATS, ...(statsData && !Array.isArray(statsData) ? statsData : {}) });

      const fwData = await fetchJsonOrThrow(`${API_BASE_URL}/api/frameworks`, { headers });
      setFrameworks(Array.isArray(fwData) ? fwData : []);

      const intData = await fetchJsonOrThrow(`${API_BASE_URL}/api/integrations`, { headers });
      setIntegrations(Array.isArray(intData) ? intData : []);

      const logsData = await fetchJsonOrThrow(`${API_BASE_URL}/api/logs`, { headers });
      setActivities(Array.isArray(logsData) ? logsData.slice(0, 5) : []);

      const deptData = await fetchJsonOrThrow(`${API_BASE_URL}/api/departments`, { headers });
      setDepartments(Array.isArray(deptData) ? deptData : []);

      const driftData = await fetchJsonOrThrow(`${API_BASE_URL}/api/drift?only_drift=true&limit=10`, { headers });
      setDrift(Array.isArray(driftData) ? driftData : []);
    } catch (err) {
      console.warn("Dashboard API unavailable; showing an empty dashboard.", err);
      setStats(DEFAULT_STATS);
      setFrameworks([]);
      setIntegrations([]);
      setActivities([]);
      setDepartments([]);
      setDrift([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const token = await getToken();
      const headers = { "Authorization": `Bearer ${token}` };
      for (const integration of integrations) {
        if (integration.status === "Connected") {
          await fetch(`${API_BASE_URL}/api/integrations/${integration.id}/sync`, { 
            method: "POST", 
            headers 
          });
        }
      }
      await fetchDashboardData();
    } catch (e) {
      console.error(e);
    }
    setTimeout(() => setSyncing(false), 1000);
  };

  const acknowledgeDrift = async (id) => {
    try {
      const token = await getToken();
      await fetch(`${API_BASE_URL}/api/drift/${id}/acknowledge`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
      });
      setDrift((prev) => prev.filter((d) => d.id !== id));
    } catch (e) {
      console.error(e);
    }
  };

  const fmtAgo = (ts) => {
    if (!ts) return "";
    const diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Department Dashboard</span>
          <h2 className="text-2xl font-semibold text-zinc-100 tracking-tight mt-0.5">
            Overview
          </h2>
          <p className="text-zinc-400 text-xs mt-0.5">
            Multi-department compliance monitoring, live integration evidence, and threat vector evaluations.
          </p>
        </div>

        <div>
          <button 
            onClick={handleSyncAll}
            disabled={syncing}
            className="flex items-center space-x-1.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 font-medium py-1.5 px-3.5 rounded-lg cursor-pointer text-xs transition-colors"
          >
            <RotateCw size={12} className={syncing ? "animate-spin text-zinc-400" : "text-zinc-500"} />
            <span>{syncing ? "Syncing..." : "Sync Systems"}</span>
          </button>
        </div>
      </div>

      {/* Compliance Drift alert (continuous monitoring) */}
      {drift.length > 0 && (
        <div className="bg-amber-950/20 border border-amber-900/50 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={15} className="text-amber-400" />
            <h3 className="font-semibold text-amber-200 text-sm">Compliance Drift Detected</h3>
            <span className="text-[10px] text-amber-300/70 bg-amber-900/30 px-2 py-0.5 rounded-full border border-amber-900/50">
              {drift.length} control{drift.length === 1 ? "" : "s"} regressed
            </span>
          </div>
          <div className="space-y-2">
            {drift.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 text-xs bg-[#121215]/60 border border-zinc-800/60 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <span className="font-medium text-zinc-200">{d.control_title}</span>
                  <span className="text-zinc-500 ml-2 font-mono text-[10px]">{d.control_code}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[11px]">
                    <span className="text-emerald-400">{d.old_status}</span>
                    <span className="text-zinc-600 mx-1">→</span>
                    <span className="text-rose-400">{d.new_status}</span>
                  </span>
                  <span className="text-zinc-600 text-[10px] hidden sm:inline">{fmtAgo(d.detected_at)}</span>
                  <button
                    onClick={() => acknowledgeDrift(d.id)}
                    className="text-[10px] text-zinc-400 hover:text-zinc-100 border border-zinc-800 hover:border-zinc-600 rounded px-2 py-0.5 transition-colors"
                  >
                    Acknowledge
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hero: control-posture donut + stat cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Control posture donut */}
        <Card title="Control Posture" subtitle="Live status across all controls">
          <PostureDonut
            passing={stats.passing_controls_count}
            warning={stats.warning_controls_count}
            failing={stats.failed_controls_count}
            score={stats.compliance_score}
          />
        </Card>

        {/* Stat cards cluster */}
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard
            label="Compliance Score"
            value={`${stats.compliance_score}%`}
            chipTone={stats.compliance_score >= 80 ? "good" : stats.compliance_score >= 50 ? "warn" : "bad"}
            chipText={`${stats.passing_controls_count}/${stats.total_controls_count} passing`}
            footnote="of all controls"
          />
          <StatCard
            label="Average Residual Risk"
            value={stats.average_residual_risk}
            valueSuffix="/ 25"
            chipTone={stats.average_residual_risk >= 15 ? "bad" : stats.average_residual_risk >= 8 ? "warn" : "good"}
            chipText={stats.average_residual_risk >= 15 ? "High" : stats.average_residual_risk >= 8 ? "Moderate" : "Low"}
            footnote="across open risks"
          />
          <StatCard
            label="Failing Controls"
            value={stats.failed_controls_count}
            chipTone={stats.failed_controls_count > 0 ? "bad" : "good"}
            chipText={stats.failed_controls_count > 0 ? "Needs review" : "All clear"}
            footnote={`of ${stats.total_controls_count} checks`}
          />
          <StatCard
            label="Active Integrations"
            value={`${stats.active_integrations}/${stats.total_integrations}`}
            chipTone={stats.active_integrations > 0 ? "good" : "neutral"}
            chipText={drift.length > 0 ? `${drift.length} drift` : "stable"}
            chipToneOverride={drift.length > 0 ? "bad" : undefined}
            footnote="connected sources"
          />
        </div>
      </div>

      {/* Row 2: Frameworks & Integrations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Frameworks List */}
        <div className="lg:col-span-2 bg-[#121215] border border-zinc-800/80 rounded-xl p-5 shadow-sm flex flex-col justify-between space-y-6">
          <div>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-zinc-150 text-sm">Regulatory Frameworks</h3>
                <p className="text-[10px] text-zinc-500 mt-0.5">Readiness scores aggregated across active checks.</p>
              </div>
            </div>

            <div className="space-y-4 mt-6">
              {frameworks.map((fw, idx) => (
                <div key={idx} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      <span className="text-[9px] font-bold text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800 font-mono">
                        {fw.code}
                      </span>
                      <span className="font-medium text-zinc-200 truncate max-w-xs">{fw.name}</span>
                    </div>
                    <div className="flex items-center space-x-2.5 text-[10px]">
                      <span className="text-zinc-500">{fw.controls_count} Controls</span>
                      <span className="font-semibold text-zinc-100">{fw.readiness}%</span>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="w-full bg-zinc-900 h-1 rounded-full overflow-hidden border border-zinc-800/40">
                    <div 
                      className="bg-zinc-100 h-full rounded-full transition-all duration-700"
                      style={{ width: `${fw.readiness}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="pt-4 border-t border-zinc-850/60 flex justify-between items-center text-[10px]">
            <span className="text-zinc-500">Readiness maps strictly to passing control ratios.</span>
            <a href="/controls" className="text-zinc-300 hover:text-zinc-100 font-medium flex items-center">
              Controls Center <ArrowRight size={10} className="ml-1" />
            </a>
          </div>
        </div>

        {/* Connections */}
        <div className="bg-[#121215] border border-zinc-800/80 rounded-xl p-5 shadow-sm flex flex-col justify-between space-y-6">
          <div>
            <div>
              <h3 className="font-semibold text-zinc-150 text-sm">Active Connections</h3>
              <p className="text-[10px] text-zinc-500 mt-0.5">Automated integration hooks.</p>
            </div>

            <div className="space-y-2.5 mt-6">
              {integrations.map((int, idx) => (
                <div key={idx} className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900/30 border border-zinc-850">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-7 h-7 rounded bg-zinc-900 flex items-center justify-center text-xs border border-zinc-800">
                      {int.id === "aws" ? "☁️" : int.id === "okta" ? "🔑" : "💻"}
                    </div>
                    <div>
                      <h4 className="text-[11px] font-medium text-zinc-200">{int.name}</h4>
                      <span className="text-[9px] text-zinc-500">{int.category}</span>
                    </div>
                  </div>
                  <div>
                    <span className={`text-[9px] font-semibold py-0.5 px-1.5 rounded ${
                      int.status === "Connected" 
                        ? "bg-emerald-500/5 text-emerald-450 border border-emerald-500/10" 
                        : "bg-zinc-800 text-zinc-500 border border-zinc-700/10"
                    }`}>
                      {int.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-zinc-850/60 flex justify-between items-center text-[10px]">
            <span className="text-zinc-500">Integrations pull live evidence.</span>
            <a href="/integrations" className="text-zinc-300 hover:text-zinc-100 font-medium flex items-center">
              Configure <ArrowRight size={10} className="ml-1" />
            </a>
          </div>
        </div>
      </div>

      <div className="bg-[#121215] border border-zinc-800/80 rounded-xl p-5 shadow-sm space-y-4">
        <div>
          <h3 className="font-semibold text-zinc-150 text-sm">Department Coverage</h3>
          <p className="text-[10px] text-zinc-500 mt-0.5">Controls and risks grouped by internal operating department.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {departments.map((dept) => (
            <div key={dept.name} className="bg-zinc-900/40 border border-zinc-850 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-200">{dept.name}</span>
                <span className="text-[10px] text-zinc-500">{dept.users_count} users</span>
              </div>
              <div className="mt-3 flex items-center justify-between text-[10px] text-zinc-500">
                <span>{dept.controls_count} controls</span>
                <span>{dept.risks_count} risks</span>
                <span className="text-emerald-400">{dept.passing_controls} passing</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Row 3: Threat Matrix & Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Risk Matrix */}
        <div className="bg-[#121215] border border-zinc-800/80 rounded-xl p-5 shadow-sm space-y-4">
          <div>
            <h3 className="font-semibold text-zinc-150 text-sm">Risk Severity Matrix</h3>
            <p className="text-[10px] text-zinc-500 mt-0.5">Relational impact vs likelihood register.</p>
          </div>

          <div className="flex flex-col space-y-1 select-none pt-2">
            {[5, 4, 3, 2, 1].map((impact) => (
              <div key={impact} className="flex items-center space-x-1">
                <span className="w-4 text-center text-[9px] font-bold text-zinc-600">{impact}</span>
                
                {[1, 2, 3, 4, 5].map((likelihood) => {
                  const score = impact * likelihood;
                  let bgClass = "bg-zinc-900 border-zinc-850/60 text-zinc-500"; 
                  if (score >= 15) bgClass = "bg-rose-500/10 border-rose-500/20 text-rose-400"; 
                  else if (score >= 8) bgClass = "bg-amber-500/5 border-amber-500/15 text-amber-500"; 
                  else if (score >= 1) bgClass = "bg-emerald-500/5 border-emerald-500/10 text-emerald-450";

                  let count = 0;
                  if (impact === 5 && likelihood == 3) count = 1; 
                  if (impact === 4 && likelihood == 3) count = 2; 
                  if (impact === 5 && likelihood == 2) count = 1; 

                  return (
                    <div 
                      key={likelihood}
                      className={`flex-1 aspect-square rounded border flex items-center justify-center text-[10px] font-semibold hover:border-zinc-500 transition-all cursor-pointer ${bgClass}`}
                      title={`Likelihood ${likelihood} x Impact ${impact} (Score: ${score})`}
                    >
                      {count > 0 ? (
                        <span className="w-4 h-4 rounded-full bg-zinc-950 flex items-center justify-center font-bold text-[9px] text-zinc-200 border border-zinc-800">
                          {count}
                        </span>
                      ) : ""}
                    </div>
                  );
                })}
              </div>
            ))}
            
            <div className="flex items-center space-x-1 pt-1">
              <span className="w-4" />
              {[1, 2, 3, 4, 5].map((l) => (
                <span key={l} className="flex-1 text-center text-[9px] font-bold text-zinc-650">{l}</span>
              ))}
            </div>
            <div className="text-center text-[8px] font-bold text-zinc-600 tracking-widest mt-2 uppercase">
              Likelihood →
            </div>
          </div>
        </div>

        {/* Activity Logs */}
        <div className="lg:col-span-2 bg-[#121215] border border-zinc-800/80 rounded-xl p-5 shadow-sm flex flex-col justify-between space-y-6">
          <div>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-zinc-150 text-sm">Audit Activity Log</h3>
                <p className="text-[10px] text-zinc-500 mt-0.5">Chronological ledger of security parameters.</p>
              </div>
              <a href="/scanner" className="text-zinc-400 hover:text-zinc-155 font-medium text-xs flex items-center">
                Launch Scanner <ArrowRight size={10} className="ml-1" />
              </a>
            </div>

            <div className="space-y-2 mt-6">
              {activities.length === 0 ? (
                <div className="py-8 text-center text-zinc-650 text-xs flex flex-col items-center justify-center space-y-2">
                  <Activity size={18} />
                  <span>No audit logs recorded yet.</span>
                </div>
              ) : (
                activities.map((act) => (
                  <div key={act.id} className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900/10 border border-zinc-850 hover:bg-zinc-900/20 transition-all">
                    <div className="flex items-center space-x-3 max-w-lg">
                      <div className={`w-1.5 h-1.5 rounded-full ${
                        act.decision === "VIOLATION" ? "bg-rose-500" : "bg-emerald-500"
                      }`} />
                      <div className="truncate">
                        <span className="text-[11px] font-medium text-zinc-200">
                          {act.justification?.summary || act.scanned_text}
                        </span>
                        <p className="text-[9px] text-zinc-500 line-clamp-1 font-mono mt-0.5">
                          Ref: {act.scanned_text}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3 text-right">
                      <span className="text-[9px] text-zinc-500 font-mono">
                        {new Date(act.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className={`text-[8px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded ${
                        act.decision === "VIOLATION" 
                          ? "bg-rose-500/10 text-rose-455 border border-rose-500/15" 
                          : "bg-emerald-500/10 text-emerald-450 border border-emerald-500/15"
                      }`}>
                        {act.decision}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="pt-4 border-t border-zinc-850/60 flex justify-between items-center text-[10px]">
            <span className="text-zinc-500">Every verification logs locally to an encrypted vault.</span>
            <a href="/audit" className="text-zinc-300 hover:text-zinc-105 font-medium flex items-center">
              Full Ledger <ArrowRight size={10} className="ml-1" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard-3 style building blocks (cards, stat cards, delta chips, donut)
// ---------------------------------------------------------------------------

function Card({ title, subtitle, children, className = "" }) {
  return (
    <div className={`bg-[#121215] border border-zinc-800/80 rounded-xl p-5 shadow-sm ${className}`}>
      {(title || subtitle) && (
        <div className="mb-4">
          {title && <h3 className="font-medium text-zinc-150 text-sm">{title}</h3>}
          {subtitle && <p className="text-[11px] text-zinc-500 mt-0.5">{subtitle}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

const CHIP_TONES = {
  good: "bg-emerald-500/10 text-emerald-400",
  bad: "bg-rose-500/10 text-rose-400",
  warn: "bg-amber-500/10 text-amber-500",
  neutral: "bg-zinc-800 text-zinc-400",
};

function DeltaChip({ tone = "neutral", children }) {
  const Icon = tone === "good" ? TrendingUp : tone === "bad" ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${CHIP_TONES[tone] || CHIP_TONES.neutral}`}>
      <Icon size={11} className="shrink-0" />
      {children}
    </span>
  );
}

function StatCard({ label, value, valueSuffix, chipTone, chipToneOverride, chipText, footnote }) {
  return (
    <div className="bg-[#121215] border border-zinc-800/80 rounded-xl p-5 shadow-sm flex flex-col gap-3">
      <span className="text-xs font-normal text-zinc-500">{label}</span>
      <p className="font-semibold text-2xl text-zinc-100 tabular-nums flex items-baseline gap-1.5">
        {value}
        {valueSuffix && <span className="text-[11px] font-normal text-zinc-600">{valueSuffix}</span>}
      </p>
      <div className="flex items-center gap-2 text-xs">
        {chipText && <DeltaChip tone={chipToneOverride || chipTone}>{chipText}</DeltaChip>}
        {footnote && <span className="text-zinc-500 text-[11px]">{footnote}</span>}
      </div>
    </div>
  );
}

// Inline SVG donut for control status, with a centered score and a legend.
function PostureDonut({ passing = 0, warning = 0, failing = 0, score = 0 }) {
  const total = passing + warning + failing;
  const segments = [
    { label: "Passing", value: passing, color: "#34d399" },
    { label: "Warning", value: warning, color: "#fbbf24" },
    { label: "Failing", value: failing, color: "#fb7185" },
  ];
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0" style={{ width: 132, height: 132 }}>
        <svg width="132" height="132" className="-rotate-90">
          <circle cx="66" cy="66" r={r} fill="none" stroke="#27272a" strokeWidth="12" />
          {total > 0 && segments.map((s) => {
            if (s.value <= 0) return null;
            const len = (s.value / total) * c;
            const dash = `${len} ${c - len}`;
            const circle = (
              <circle
                key={s.label}
                cx="66" cy="66" r={r} fill="none"
                stroke={s.color} strokeWidth="12"
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += len;
            return circle;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold text-zinc-100 tabular-nums">{total > 0 ? `${score}%` : "—"}</span>
          <span className="text-[9px] uppercase tracking-widest text-zinc-500">Ready</span>
        </div>
      </div>
      <div className="space-y-2 text-xs flex-1 min-w-0">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-zinc-400">
              <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="font-semibold text-zinc-200 tabular-nums">{s.value}</span>
          </div>
        ))}
        {total === 0 && (
          <p className="text-[11px] text-zinc-600 pt-1">No controls yet. Import a framework to populate posture.</p>
        )}
      </div>
    </div>
  );
}



