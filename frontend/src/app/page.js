"use client";

import { useState, useEffect, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import {
  ShieldCheck, AlertTriangle, RotateCw, AlertOctagon,
  ArrowRight, Activity, CheckCircle2, FileCheck, Info
} from "lucide-react";
import { useApi } from "./lib/api";
import {
  PageContainer, PageHeader, Card, CardHeader, StatCard, StatCardSkeleton,
  Badge, statusVariant, Button, EmptyState, ProgressBar, Skeleton, cn,
  GaugeChart, ProgressRing, Tooltip
} from "./components/ui";

const DEFAULT_STATS = {
  compliance_score: 0,
  average_residual_risk: 0,
  failed_controls_count: 0,
  warning_controls_count: 0,
  passing_controls_count: 0,
  total_controls_count: 0,
  total_risks_count: 0,
  high_risks_count: 0,
  active_integrations: 0,
  total_integrations: 0,
  risk_matrix: [],
  evidence_summary: { total: 0, current: 0, expiring: 0, expired: 0 },
  days_until_next_audit: null,
  compliance_delta: null,
};


export default function DashboardPage() {
  const { user } = useUser();
  const api = useApi();

  const [stats, setStats] = useState(DEFAULT_STATS);
  const [frameworks, setFrameworks] = useState([]);
  const [integrations, setIntegrations] = useState([]);
  const [activities, setActivities] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);

  const fetchDashboardData = useCallback(async () => {
    setError(null);
    try {
      const [statsData, fwData, intData, logsData, deptData] = await api.getMany([
        "/api/dashboard/stats",
        "/api/frameworks",
        "/api/integrations",
        "/api/logs",
        "/api/departments",
      ]);
      setStats({ ...DEFAULT_STATS, ...(statsData && !Array.isArray(statsData) ? statsData : {}) });
      setFrameworks(Array.isArray(fwData) ? fwData : []);
      setIntegrations(Array.isArray(intData) ? intData : []);
      setActivities(Array.isArray(logsData) ? logsData.slice(0, 6) : []);
      setDepartments(Array.isArray(deptData) ? deptData : []);
    } catch (err) {
      console.warn("Dashboard data unavailable.", err);
      setError("Could not reach the compliance backend. Showing an empty dashboard.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const connected = integrations.filter((i) => i.status === "Connected");
      await Promise.allSettled(connected.map((i) => api.post(`/api/integrations/${i.id}/sync`)));
      await fetchDashboardData();
    } catch (e) {
      console.error(e);
    } finally {
      setSyncing(false);
    }
  };

  const riskTone = stats.average_residual_risk >= 15 ? "danger" : stats.average_residual_risk >= 8 ? "warning" : "success";
  const riskLabel = stats.average_residual_risk >= 15 ? "High exposure" : stats.average_residual_risk >= 8 ? "Moderate" : "Low";
  const firstName = user?.firstName;

  return (
    <PageContainer>
      <div className="flex items-center justify-between mb-8 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            {firstName ? `Welcome back, ${firstName}` : "Compliance Overview"}
          </h1>
          <p className="text-zinc-400 mt-1">Multi-department compliance posture, live integration evidence, and risk exposure.</p>
        </div>
        <div className="flex gap-3">
          <Button variant="primary" icon={RotateCw} loading={syncing} onClick={handleSyncAll} disabled={loading} className="animate-pulse-glow">
            {syncing ? "Syncing…" : "Sync systems"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-6 animate-fade-in">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8 stagger-children items-start">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <div className="glass-card p-5 relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="flex justify-between items-start mb-4">
                <span className="text-sm font-medium uppercase tracking-wide text-zinc-400">Compliance Score</span>
                <ShieldCheck size={20} className="text-indigo-400" />
              </div>
              <div className="flex items-center justify-center py-2">
                <GaugeChart 
                  value={stats.compliance_score} 
                  max={100} 
                  size={140} 
                  strokeWidth={12} 
                  color={stats.compliance_score >= 80 ? '#34d399' : stats.compliance_score >= 50 ? '#fbbf24' : '#fb7185'} 
                  label="Score" 
                />
              </div>
              <div className="text-center mt-2">
                <p className="text-xs text-zinc-500">
                  {stats.compliance_delta > 0 && <span className="text-emerald-400 inline-flex items-center">↑ {stats.compliance_delta} pts</span>}
                  {stats.compliance_delta < 0 && <span className="text-rose-400 inline-flex items-center">↓ {Math.abs(stats.compliance_delta)} pts</span>}
                  {(!stats.compliance_delta) && "No change since last snapshot"}
                </p>
                <p className="text-xs text-zinc-400 mt-1">{stats.passing_controls_count}/{stats.total_controls_count} controls passing</p>
              </div>
            </div>

            <StatCard
              label="Average Residual Risk"
              value={stats.average_residual_risk}
              suffix="/ 25"
              accent={riskTone}
              icon={AlertTriangle}
              delta={{ direction: "neutral", label: `${riskLabel} · ${stats.high_risks_count} high-severity` }}
              className="glass-card"
            />
            <StatCard
              label="Failing Controls"
              value={stats.failed_controls_count}
              accent={stats.failed_controls_count > 0 ? "danger" : "success"}
              icon={AlertOctagon}
              footer={stats.failed_controls_count > 0 ? "Require attention" : "All controls healthy"}
              className="glass-card"
            />
            <StatCard
              label="Evidence Currency"
              value={stats.evidence_summary.current}
              suffix={`/ ${stats.evidence_summary.total}`}
              accent={stats.evidence_summary.expired > 0 ? "warning" : "accent"}
              icon={FileCheck}
              footer={
                stats.days_until_next_audit != null
                  ? `${stats.days_until_next_audit} days until next audit`
                  : `${stats.evidence_summary.expired} expired · ${stats.evidence_summary.expiring} expiring`
              }
              className="glass-card"
            />
          </>
        )}
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 stagger-children">
        <div className="lg:col-span-2 glass-card overflow-hidden flex flex-col">
          <CardHeader
            title="Regulatory Frameworks"
            description="Readiness aggregated across active control checks."
            action={
              <a href="/controls" className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors">
                View Controls <ArrowRight size={14} />
              </a>
            }
          />
          <div className="p-5 flex-1 flex flex-col">
            {loading ? (
              <div className="space-y-6">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : frameworks.length === 0 ? (
              <EmptyState
                icon={ShieldCheck}
                title="No frameworks imported"
                description="Import SOC 2, ISO 27001, NIST CSF or others to start tracking readiness."
                action={<Button as="a" href="/controls" variant="primary" size="sm">Import a framework</Button>}
              />
            ) : (
              <div className="space-y-6">
                {frameworks.map((fw) => {
                  const readiness = Math.round(fw.readiness || 0);
                  const tone = readiness >= 80 ? "success" : readiness >= 50 ? "warning" : "danger";
                  return (
                    <div key={fw.id || fw.code} className="group">
                      <div className="flex items-center justify-between text-sm mb-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-[11px] font-semibold text-indigo-300 bg-indigo-500/10 px-2.5 py-1 rounded-md border border-indigo-500/20 font-mono transition-colors group-hover:border-indigo-500/40 group-hover:bg-indigo-500/20">
                            {fw.code}
                          </span>
                          <span className="font-medium text-zinc-100 truncate text-base">{fw.name}</span>
                        </div>
                        <div className="flex items-center gap-4 shrink-0 text-xs">
                          <span className="text-zinc-400">{fw.controls_count} controls mapped</span>
                          <span className={`font-bold tabular-nums w-10 text-right ${readiness >= 80 ? 'text-emerald-400' : readiness >= 50 ? 'text-amber-400' : 'text-rose-400'}`}>
                            {readiness}%
                          </span>
                        </div>
                      </div>
                      <ProgressBar value={readiness} tone={tone} className="h-2.5 rounded-full bg-zinc-800" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="glass-card flex flex-col">
          <CardHeader
            title="Active Connections"
            description="Live evidence integrations."
            action={
              <a href="/integrations" className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
                Configure <ArrowRight size={14} />
              </a>
            }
          />
          <div className="p-5 flex-1 flex flex-col">
            {loading ? (
              <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
              </div>
            ) : integrations.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="No integrations yet"
                description="Connect a data source to pull live compliance evidence."
              />
            ) : (
              <div className="space-y-3">
                {integrations.map((int) => (
                  <div
                    key={int.id}
                    className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 hover:border-indigo-500/30 hover:bg-zinc-800/80 transition-all duration-300"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center text-sm font-bold text-indigo-300 border border-indigo-500/30 shrink-0 shadow-[0_0_15px_rgba(99,102,241,0.15)]">
                        {(int.name || int.id || "?").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 min-h-[3.625rem] flex flex-col justify-center">
                        <h4 className="text-[15px] font-semibold text-zinc-100 leading-snug">{int.name}</h4>
                        <span className="text-xs text-zinc-400">{int.category}</span>
                      </div>
                    </div>
                    <Badge variant={statusVariant(int.status)} className="px-2.5 py-1 text-xs shrink-0">{int.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Risk matrix + activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 stagger-children">
        <div className="glass-card">
          <CardHeader title="Risk Severity Matrix" description="Live impact × likelihood register." />
          <div className="p-5">
            <RiskMatrix matrix={stats.risk_matrix} loading={loading} total={stats.total_risks_count} />
          </div>
        </div>

        <div className="lg:col-span-2 glass-card flex flex-col">
          <CardHeader
            title="Audit Activity Log"
            description="Chronological ledger of scanner decisions."
            action={
              <a href="/scanner" className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors">
                Launch scanner <ArrowRight size={14} />
              </a>
            }
          />
          <div className="p-5 flex-1 flex flex-col">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
              </div>
            ) : activities.length === 0 ? (
              <EmptyState icon={Activity} title="No audit logs yet" description="Scanner verifications will appear here as they run." />
            ) : (
              <div className="space-y-3">
                {activities.map((act) => {
                  const violation = act.decision === "VIOLATION";
                  return (
                    <div
                      key={act.id}
                      className="flex items-center justify-between gap-4 p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-800/60 transition-all duration-300"
                    >
                      <div className="flex items-center gap-4 min-w-0 flex-1">
                        <div className={cn("w-2 h-10 rounded-full shrink-0 shadow-[0_0_10px_currentColor]", violation ? "bg-rose-500 text-rose-500" : "bg-emerald-500 text-emerald-500")} />
                        <div className="min-w-0">
                          <p className="text-[15px] font-medium text-zinc-100 line-clamp-1">
                            {act.justification?.summary || act.scanned_text}
                          </p>
                          <p className="text-xs text-zinc-400 truncate font-mono mt-1 flex items-center gap-1">
                            <span className="text-indigo-400">REF:</span> {act.scanned_text}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <Badge variant={violation ? "danger" : "success"} className="px-3 py-1 font-semibold">{act.decision}</Badge>
                        <span className="text-xs text-zinc-500 font-mono flex items-center gap-1">
                          {new Date(act.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

/**
 * RiskMatrix — renders the 5×5 grid purely from the backend distribution.
 */
function RiskMatrix({ matrix, loading, total }) {
  if (loading) return <Skeleton className="h-64 w-full rounded-xl" />;

  const lookup = new Map((matrix || []).map((c) => [`${c.impact}-${c.likelihood}`, c.count]));

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1.5 select-none pt-2">
        {[5, 4, 3, 2, 1].map((impact) => (
          <div key={impact} className="flex items-center gap-2">
            <span className="w-5 text-center text-xs font-bold text-zinc-500">{impact}</span>
            {[1, 2, 3, 4, 5].map((likelihood) => {
              const score = impact * likelihood;
              const count = lookup.get(`${impact}-${likelihood}`) || 0;
              const tone =
                score >= 15
                  ? "bg-rose-500/20 border-rose-500/40 text-rose-300 shadow-[0_0_15px_rgba(244,63,94,0.1)]"
                  : score >= 8
                  ? "bg-amber-500/15 border-amber-500/30 text-amber-300"
                  : "bg-emerald-500/15 border-emerald-500/30 text-emerald-300";
              return (
                <div
                  key={likelihood}
                  title={`Impact ${impact} × Likelihood ${likelihood} (score ${score}) — ${count} risk${count === 1 ? "" : "s"}`}
                  className={cn(
                    "flex-1 aspect-square rounded-lg border flex items-center justify-center transition-all duration-300 hover:scale-[1.08] hover:z-10 cursor-pointer relative",
                    tone,
                    count > 0 ? "opacity-100" : "opacity-30 border-dashed border-zinc-800 bg-transparent"
                  )}
                >
                  {count > 0 && (
                    <span className="min-w-6 h-6 px-1.5 rounded-full bg-zinc-950/90 flex items-center justify-center text-[13px] font-bold text-white border border-zinc-700/80 shadow-xl">
                      {count}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        <div className="flex items-center gap-2 pt-2">
          <span className="w-5" />
          {[1, 2, 3, 4, 5].map((l) => (
            <span key={l} className="flex-1 text-center text-xs font-bold text-zinc-500">{l}</span>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-3 border-t border-zinc-800/50">
        <span className="uppercase tracking-widest font-semibold text-zinc-500">Likelihood →</span>
        <span className="font-medium bg-zinc-800/50 px-2 py-1 rounded-md">{total} total risks</span>
      </div>
    </div>
  );
}
