"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Cloud, Key, Code, Users, Terminal, X, ShieldAlert, Server, Laptop, Plug,
} from "lucide-react";
import { useApi, ApiError } from "../lib/api";
import {
  PageContainer, PageHeader, Card, Badge, Button, Skeleton, EmptyState,
  Modal, Field, Textarea, cn,
} from "../components/ui";

// Per-connector presentation + credential hints. Connectors themselves come from
// the backend catalog (/api/integrations); this only drives icons/help text.
const CONNECTOR_META = {
  aws: { emoji: "☁️", desc: "Audits S3 bucket encryption and storage security configuration.", label: "AWS Access Credentials", ph: '{"aws_access_key_id":"...","aws_secret_access_key":"...","bucket_name":"..."}' },
  gcp: { emoji: "🌥️", desc: "Audits GCS bucket encryption and public-access prevention.", label: "GCP Service Account JSON", ph: '{"service_account_json":"{...}","bucket_name":"my-bucket","project_id":"my-proj"}' },
  azure: { emoji: "🟦", desc: "Audits Storage Account secure-transfer and encryption settings.", label: "Azure Service Principal", ph: '{"tenant_id":"...","client_id":"...","client_secret":"...","subscription_id":"...","resource_group":"...","account_name":"..."}' },
  okta: { emoji: "🔑", desc: "Retrieves user rosters and verifies MFA factor enrollment.", label: "Okta API Token / Org URL", ph: '{"org_url":"https://dev-xxxxx.okta.com","token":"..."}' },
  auth0: { emoji: "🛡️", desc: "Audits directory users, MFA Guardian enrollment, login logs, and roles.", label: "Auth0 M2M Credentials", ph: '{"domain":"your-tenant.us.auth0.com","client_id":"...","client_secret":"..."}' },
  entra: { emoji: "🟦", desc: "Audits Entra ID users and MFA via Microsoft Graph.", label: "Entra (Graph) App Registration", ph: '{"tenant_id":"...","client_id":"...","client_secret":"..."}' },
  google_workspace: { emoji: "🅖", desc: "Audits Workspace users and 2-Step Verification enrollment.", label: "Workspace Service Account", ph: '{"service_account_json":"{...}","admin_email":"admin@yourco.com"}' },
  github: { emoji: "💻", desc: "Evaluates branch protection and pull request review rules.", label: "GitHub Personal Access Token", ph: '{"token":"ghp_...","owner":"your-org","repo":"your-repo","branch":"main"}' },
  snyk: { emoji: "🐶", desc: "Audits open critical/high vulnerabilities across monitored projects.", label: "Snyk API Token + Org", ph: '{"token":"...","org_id":"..."}' },
  crowdstrike: { emoji: "🦅", desc: "Audits endpoint sensor coverage and detection posture.", label: "CrowdStrike API Client", ph: '{"client_id":"...","client_secret":"...","base_url":"https://api.crowdstrike.com"}' },
  jamf: { emoji: "📱", desc: "Validates managed Mac enrollment and FileVault disk encryption.", label: "Jamf Pro API Client", ph: '{"base_url":"https://yourorg.jamfcloud.com","client_id":"...","client_secret":"..."}' },
  workday: { emoji: "👥", desc: "Syncs active worker roster via a RaaS report endpoint.", label: "Workday RaaS Report", ph: '{"report_url":"https://...","username":"ISU","password":"..."}' },
};
const metaFor = (id) => CONNECTOR_META[id] || { emoji: "🔌", desc: "Connect this system to pull live compliance evidence.", label: "API Credentials (JSON)", ph: '{"...":"..."}' };

const CATEGORY_ICON = {
  CLOUD: <Cloud size={14} />,
  IDENTITY: <Key size={14} />,
  DEVELOPER: <Code size={14} />,
  HRIS: <Users size={14} />,
  EDR: <Laptop size={14} />,
};
const statusVariantFor = (s) =>
  s === "Connected" ? "success" : s === "Configured" ? "accent" : s === "Error" ? "danger" : "neutral";

export default function IntegrationsPage() {
  const api = useApi();
  const [integrations, setIntegrations] = useState([]);
  const [category, setCategory] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [syncLogs, setSyncLogs] = useState(null);
  const [activeIntegration, setActiveIntegration] = useState(null);
  const [credentials, setCredentials] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [syncingId, setSyncingId] = useState(null);
  const [connectionMode, setConnectionMode] = useState("api");

  const fetchIntegrations = useCallback(async () => {
    try {
      const data = await api.get("/api/integrations");
      setIntegrations(Array.isArray(data) ? data : []);
    } catch {
      setIntegrations([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("status") === "success" && params.get("id")) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
    fetchIntegrations();
  }, [fetchIntegrations]);

  const handleConnect = async (e) => {
    e.preventDefault();

    if (connectionMode === "oauth") {
      try {
        const res = await api.raw("GET", `/api/integrations/${activeIntegration.id}/authorize`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          alert(data.detail || "OAuth is not configured for this connector.");
          return;
        }
        window.location.href = res.url;
      } catch (err) {
        alert(`OAuth request failed: ${err.message}`);
      }
      return;
    }

    const apiCreds = credentials.trim();
    if (!apiCreds) {
      alert("Enter real read-only credentials before connecting this system.");
      return;
    }

    setConnecting(true);
    try {
      await api.post("/api/integrations/connect", { id: activeIntegration.id, credentials: apiCreds });
      setActiveIntegration(null);
      setCredentials("");
      await fetchIntegrations();
    } catch (err) {
      alert(`Failed to connect integration: ${err instanceof ApiError ? err.message : err}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleSync = async (id) => {
    setSyncingId(id);
    try {
      const data = await api.post(`/api/integrations/${id}/sync`);
      if (data?.status === "sync_started") {
        const logData = await api.get(`/api/integrations/${id}/logs`);
        setSyncLogs({ integration: id, entries: Array.isArray(logData) ? logData : [] });
        await fetchIntegrations();
      }
    } catch {
      setSyncLogs({
        integration: id,
        entries: [{ level: "ERROR", message: "Could not reach the backend integration gateway." }],
      });
    } finally {
      setSyncingId(null);
    }
  };

  const filtered = useMemo(
    () => (category === "ALL" ? integrations : integrations.filter((i) => i?.category?.toUpperCase() === category)),
    [integrations, category]
  );

  return (
    <PageContainer>
      <PageHeader
        eyebrow="System Connectors"
        title="Integrations Center"
        description="Securely connect cloud services, repositories, identity managers, and HR systems to pull live evidence."
      />

      <div className="flex border-b border-zinc-800 gap-6 overflow-x-auto">
        {["ALL", "CLOUD", "IDENTITY", "DEVELOPER", "EDR", "HRIS"].map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={cn(
              "pb-3 font-semibold text-xs tracking-wider uppercase border-b-2 cursor-pointer transition-colors whitespace-nowrap",
              category === cat ? "border-indigo-400 text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-300"
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={Plug}
            title={integrations.length === 0 ? "Connector catalog unavailable" : "No connectors in this category"}
            description={integrations.length === 0 ? "The backend catalog could not be loaded." : "Pick another category tab above."}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((item) => {
            const meta = metaFor(item.id);
            const connected = item.status === "Connected" || item.status === "Configured";
            return (
              <Card key={item.id} hover className="flex flex-col justify-between gap-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-zinc-900 flex items-center justify-center text-xl border border-zinc-800 shrink-0">
                      {meta.emoji}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-zinc-100 leading-snug truncate">{item.name}</h3>
                      <span className="flex items-center gap-1.5 text-xs text-zinc-500 font-medium mt-0.5 uppercase">
                        {CATEGORY_ICON[item.category?.toUpperCase()] || <Server size={14} />}
                        {item.category}
                      </span>
                    </div>
                  </div>
                  <Badge variant={statusVariantFor(item.status)}>{item.status}</Badge>
                </div>

                <p className="text-sm text-zinc-400 leading-relaxed min-h-[40px]">{meta.desc}</p>

                <div className="flex items-center justify-between pt-4 border-t border-zinc-800/60 text-xs">
                  <span className="text-zinc-500">
                    {item.last_sync
                      ? `Synced ${new Date(item.last_sync * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : "Never synced"}
                  </span>
                  {connected ? (
                    <Button size="sm" loading={syncingId === item.id} onClick={() => handleSync(item.id)}>
                      {syncingId === item.id ? "Syncing…" : "Sync now"}
                    </Button>
                  ) : (
                    <Button size="sm" variant="primary" onClick={() => { setActiveIntegration(item); setConnectionMode("api"); }}>
                      Connect
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Sync log overlay */}
      {syncLogs && (
        <div className="fixed bottom-6 right-6 w-96 max-w-[calc(100vw-3rem)] ui-card ui-fade-in shadow-2xl p-4 z-50 text-xs">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-3">
            <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
              <Terminal size={14} className="text-zinc-400" />
              Sync output: {syncLogs.integration.toUpperCase()}
            </span>
            <button onClick={() => setSyncLogs(null)} className="text-zinc-500 hover:text-zinc-200 cursor-pointer">
              <X size={14} />
            </button>
          </div>
          <div className="font-mono bg-[#09090b] p-3 rounded-lg h-44 overflow-y-auto space-y-1.5 text-xs custom-scrollbar border border-zinc-800">
            {syncLogs.entries.map((log, idx) => (
              <div key={idx} className="flex items-start gap-1.5">
                <span className={cn("font-semibold", log.level === "SUCCESS" ? "text-emerald-400" : log.level === "WARNING" ? "text-amber-400" : "text-rose-400")}>
                  [{log.level}]
                </span>
                <span className="break-all text-zinc-300">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connect modal */}
      <Modal
        open={!!activeIntegration}
        onClose={() => { setActiveIntegration(null); setCredentials(""); }}
        title={activeIntegration ? `Connect ${activeIntegration.name}` : ""}
        description="Save real read-only credentials, then run Sync to pull live control data."
        size="md"
      >
        {activeIntegration && (
          <>
            <div className="flex border border-zinc-800 rounded-lg overflow-hidden text-xs">
              {["api", "oauth"].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setConnectionMode(mode)}
                  className={cn(
                    "flex-1 py-2 font-semibold cursor-pointer transition-colors border-zinc-800",
                    mode === "api" && "border-r",
                    connectionMode === mode ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  {mode === "api" ? "🔑 API Credentials" : "🌐 OAuth Web Connection"}
                </button>
              ))}
            </div>

            <form onSubmit={handleConnect} className="space-y-4">
              {connectionMode === "api" ? (
                <Field label={metaFor(activeIntegration.id).label}>
                  <Textarea
                    value={credentials}
                    onChange={(e) => setCredentials(e.target.value)}
                    placeholder={metaFor(activeIntegration.id).ph}
                    rows={4}
                    className="font-mono resize-none"
                  />
                  <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/5 p-3 rounded-lg border border-amber-500/15 mt-2">
                    <ShieldAlert size={14} className="shrink-0 text-amber-400 mt-0.5" />
                    <span>Credentials are encrypted with the server BYOK vault. Use read-only audit scopes only.</span>
                  </div>
                </Field>
              ) : (
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-xs text-zinc-400 space-y-2">
                  <div className="flex items-center gap-2 font-semibold text-zinc-200">
                    <Cloud size={14} className="text-zinc-400" />
                    OAuth &amp; web redirect mode
                  </div>
                  <p className="leading-relaxed">
                    GitHub can use OAuth when GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are configured on the backend.
                    Other systems use API credentials.
                  </p>
                </div>
              )}

              <Button type="submit" variant="primary" loading={connecting} className="w-full">
                {connecting ? "Verifying…" : connectionMode === "api" ? `Save ${activeIntegration.name} credentials` : "Authorize web connection"}
              </Button>
            </form>
          </>
        )}
      </Modal>
    </PageContainer>
  );
}
