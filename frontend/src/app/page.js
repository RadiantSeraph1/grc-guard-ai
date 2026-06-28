"use client";

import { useState, useEffect, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import {
  ShieldCheck, AlertTriangle, RotateCw, AlertOctagon,
  ArrowRight, Activity, CheckCircle2, FileCheck,
} from "lucide-react";
import { useApi } from "./lib/api";
import {
  PageContainer, PageHeader, Card, CardHeader, StatCard, StatCardSkeleton,
  Badge, statusVariant, Button, EmptyState, ProgressBar, Skeleton, cn,
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
      <PageHeader
        eyebrow="Department Dashboard"
        title={firstName ? `Welcome back, ${firstName}` : "Compliance Overview"}
        description="Multi-department compliance posture, live integration evidence, and risk exposure at a glance."
        actions={
          <Button variant="secondary" icon={RotateCw} loading={syncing} onClick={handleSyncAll} disabled={loading}>
            {syncing ? "Syncing…" : "Sync systems"}
          </Button>
        }
      />

      {error && (
        <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard
              label="Compliance Score"
              value={stats.compliance_score}
              suffix="%"
              accent={stats.compliance_score >= 80 ? "success" : stats.compliance_score >= 50 ? "warning" : "danger"}
              icon={ShieldCheck}
              delta={
                stats.compliance_delta != null && stats.compliance_delta !== 0
                  ? {
                      direction: stats.compliance_delta > 0 ? "up" : "down",
                      label: `${stats.compliance_delta > 0 ? "+" : ""}${stats.compliance_delta} pts since last snapshot`,
                    }
                  : undefined
              }
              footer={`${stats.passing_controls_count}/${stats.total_controls_count} controls passing`}
            />
            <StatCard
              label="Average Residual Risk"
              value={stats.average_residual_risk}
              suffix="/ 25"
              accent={riskTone}
              icon={AlertTriangle}
              delta={{ direction: "neutral", label: `${riskLabel} · ${stats.high_risks_count} high-severity` }}
            />
            <StatCard
              label="Failing Controls"
              value={stats.failed_controls_count}
              accent={stats.failed_controls_count > 0 ? "danger" : "success"}
              icon={AlertOctagon}
              footer={stats.failed_controls_count > 0 ? "Require remediation" : "All controls healthy"}
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
            />
          </>
        )}
      </div>

      {/* Frameworks + connections */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 flex flex-col">
          <CardHeader
            title="Regulatory Frameworks"
            description="Readiness aggregated across active control checks."
            action={
              <a href="/controls" className="text-xs text-zinc-400 hover:text-zinc-100 flex items-center gap-1">
                Controls <ArrowRight size={12} />
              </a>
            }
          />
          {loading ? (
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : frameworks.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No frameworks imported"
              description="Import SOC 2, ISO 27001, NIST CSF or others to start tracking readiness."
              action={<Button as="a" href="/controls" variant="primary" size="sm">Import a framework</Button>}
            />
          ) : (
            <div className="space-y-4 flex-1">
              {frameworks.map((fw) => {
                const readiness = Math.round(fw.readiness || 0);
                const tone = readiness >= 80 ? "success" : readiness >= 50 ? "warning" : "danger";
                return (
                  <div key={fw.id || fw.code} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[11px] font-semibold text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800 font-mono">
                          {fw.code}
                        </span>
                        <span className="font-medium text-zinc-200 truncate">{fw.name}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 text-xs">
                        <span className="text-zinc-500">{fw.controls_count} controls</span>
                        <span className="font-semibold text-zinc-100 tabular-nums w-9 text-right">{readiness}%</span>
                      </div>
                    </div>
                    <ProgressBar value={readiness} tone={tone} />
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="flex flex-col">
          <CardHeader
            title="Active Connections"
            description="Live evidence integrations."
            action={
              <a href="/integrations" className="text-xs text-zinc-400 hover:text-zinc-100 flex items-center gap-1">
                Configure <ArrowRight size={12} />
              </a>
            }
          />
          {loading ? (
            <div className="space-y-2.5">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : integrations.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No integrations yet"
              description="Connect a data source to pull live compliance evidence."
            />
          ) : (
            <div className="space-y-2.5 flex-1">
              {integrations.map((int) => (
                <div
                  key={int.id}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900/40 border border-zinc-800/70"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-zinc-900 flex items-center justify-center text-xs font-semibold text-zinc-300 border border-zinc-800 shrink-0">
                      {(int.name || int.id || "?").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-medium text-zinc-200 truncate">{int.name}</h4>
                      <span className="text-xs text-zinc-500">{int.category}</span>
                    </div>
                  </div>
                  <Badge variant={statusVariant(int.status)}>{int.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Department coverage */}
      <Card>
        <CardHeader title="Department Coverage" description="Controls and risks grouped by operating department." />
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : departments.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No departments configured" description="Add users and assign departments to see coverage." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {departments.map((dept) => (
              <div key={dept.id || dept.name} className="bg-zinc-900/40 border border-zinc-800/70 rounded-lg p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-zinc-200 truncate">{dept.name}</span>
                  <span className="text-xs text-zinc-500 shrink-0">{dept.users_count} users</span>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                  <span>{dept.controls_count} controls</span>
                  <span>{dept.risks_count} risks</span>
                  <span className="text-emerald-400">{dept.passing_controls} passing</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Risk matrix + activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader title="Risk Severity Matrix" description="Live impact × likelihood register." />
          <RiskMatrix matrix={stats.risk_matrix} loading={loading} total={stats.total_risks_count} />
        </Card>

        <Card className="lg:col-span-2 flex flex-col">
          <CardHeader
            title="Audit Activity Log"
            description="Chronological ledger of scanner decisions."
            action={
              <a href="/scanner" className="text-xs text-zinc-400 hover:text-zinc-100 flex items-center gap-1">
                Launch scanner <ArrowRight size={12} />
              </a>
            }
          />
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : activities.length === 0 ? (
            <EmptyState icon={Activity} title="No audit logs yet" description="Scanner verifications will appear here as they run." />
          ) : (
            <div className="space-y-2 flex-1">
              {activities.map((act) => {
                const violation = act.decision === "VIOLATION";
                return (
                  <div
                    key={act.id}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-zinc-900/30 border border-zinc-800/70 hover:bg-zinc-900/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={cn("w-2 h-2 rounded-full shrink-0", violation ? "bg-rose-500" : "bg-emerald-500")} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-200 truncate">
                          {act.justification?.summary || act.scanned_text}
                        </p>
                        <p className="text-xs text-zinc-500 truncate font-mono mt-0.5">Ref: {act.scanned_text}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-zinc-500 font-mono">
                        {new Date(act.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <Badge variant={violation ? "danger" : "success"}>{act.decision}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </PageContainer>
  );
}

/**
 * RiskMatrix — renders the 5×5 grid purely from the backend distribution.
 * Each cell color reflects its inherent score (impact × likelihood); the badge
 * shows the real count of risks sitting in that cell.
 */
function RiskMatrix({ matrix, loading, total }) {
  if (loading) return <Skeleton className="h-56 w-full" />;

  const lookup = new Map((matrix || []).map((c) => [`${c.impact}-${c.likelihood}`, c.count]));

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-1 select-none pt-1">
        {[5, 4, 3, 2, 1].map((impact) => (
          <div key={impact} className="flex items-center gap-1">
            <span className="w-4 text-center text-xs font-bold text-zinc-600">{impact}</span>
            {[1, 2, 3, 4, 5].map((likelihood) => {
              const score = impact * likelihood;
              const count = lookup.get(`${impact}-${likelihood}`) || 0;
              const tone =
                score >= 15
                  ? "bg-rose-500/15 border-rose-500/25"
                  : score >= 8
                  ? "bg-amber-500/10 border-amber-500/20"
                  : "bg-emerald-500/10 border-emerald-500/15";
              return (
                <div
                  key={likelihood}
                  title={`Impact ${impact} × Likelihood ${likelihood} (score ${score}) — ${count} risk${count === 1 ? "" : "s"}`}
                  className={cn(
                    "flex-1 aspect-square rounded border flex items-center justify-center transition-all hover:scale-[1.04] cursor-default",
                    tone
                  )}
                >
                  {count > 0 && (
                    <span className="min-w-5 h-5 px-1 rounded-full bg-zinc-950/80 flex items-center justify-center text-xs font-bold text-zinc-100 border border-zinc-700">
                      {count}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        <div className="flex items-center gap-1 pt-1">
          <span className="w-4" />
          {[1, 2, 3, 4, 5].map((l) => (
            <span key={l} className="flex-1 text-center text-xs font-bold text-zinc-600">{l}</span>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-1">
        <span className="uppercase tracking-widest font-semibold">Likelihood →</span>
        <span>{total} risk{total === 1 ? "" : "s"} mapped</span>
      </div>
    </div>
  );
}
