"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Cloud, Key, Code, Users, X, ShieldAlert, Server, Laptop, Plug,
} from "lucide-react";
import { useApi, ApiError } from "../lib/api";
import {
  PageContainer, PageHeader, Card, Badge, Button, Skeleton, EmptyState,
  Modal, Field, Input, Textarea, cn,
} from "../components/ui";

// Per-connector presentation + credential hints. Connectors themselves come from
// the backend catalog (/api/integrations); this only drives icons/help text.
const CONNECTOR_META = {
  gcp: "Audits project posture: bucket public-access prevention and SSH/RDP firewall exposure.",
  google_workspace: "Audits identity posture: 2SV for all users, 2SV for admins, and dormant accounts.",
  fineract: "Audits core-banking controls on the ledger: maker-checker (four-eyes) approval, password policy, and audit trail.",
  wazuh: "Audits endpoint/EDR posture: agent sensor coverage, outdated agents, and security manager health.",
};
const descFor = (id) => CONNECTOR_META[id] || "Connect this system to pull live compliance evidence.";

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
  const [credValues, setCredValues] = useState({});
  const [fieldsMap, setFieldsMap] = useState({});
  const [oauthIds, setOauthIds] = useState([]);
  const [connecting, setConnecting] = useState(false);
  const [syncingId, setSyncingId] = useState(null);
  const [connectionMode, setConnectionMode] = useState("api");

  const fetchIntegrations = useCallback(async () => {
    try {
      const data = await api.get("/api/integrations");
      setIntegrations(Array.isArray(data) ? data : []);
      try {
        const spec = await api.get("/api/integrations/fields");
        setFieldsMap(spec.fields || {});
        setOauthIds(spec.oauth || []);
      } catch { /* form falls back to a generic token field */ }
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
        // The endpoint returns the vendor authorize URL as JSON; navigating the
        // browser there avoids the CORS wall a fetch() redirect would hit.
        const data = await api.get(`/api/integrations/${activeIntegration.id}/authorize`);
        window.location.href = data.authorize_url;
      } catch (err) {
        alert(err instanceof ApiError ? err.message : `OAuth request failed: ${err.message}`);
      }
      return;
    }

    const spec = fieldsMap[activeIntegration.id] || [];
    const payload = {};
    for (const f of spec) {
      const v = (credValues[f.key] || "").trim();
      if (v) payload[f.key] = v;
      else if (f.required !== false) {
        alert(`"${f.label}" is required.`);
        return;
      }
    }
    if (Object.keys(payload).length === 0) {
      alert("Enter real read-only credentials before connecting this system.");
      return;
    }

    setConnecting(true);
    try {
      await api.post("/api/integrations/connect", { id: activeIntegration.id, credentials: JSON.stringify(payload) });
      setActiveIntegration(null);
      setCredValues({});
      await fetchIntegrations();
    } catch (err) {
      alert(`Failed to connect integration: ${err instanceof ApiError ? err.message : err}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleSync = async (id) => {
    setSyncingId(id);
    setSyncLogs(null);
    try {
      const started = await api.post(`/api/integrations/${id}/sync`);
      if (started?.status !== "sync_started") return;
      // The audit runs as a backend background task, so poll the result until it
      // lands (level flips from INFO once last_audit_summary is written).
      let result = null;
      for (let i = 0; i < 20 && !result; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const logs = await api.get(`/api/integrations/${id}/logs`);
        const entry = Array.isArray(logs) ? logs[0] : null;
        if (entry && entry.level !== "INFO") result = entry;
      }
      await fetchIntegrations();
      setSyncLogs({ integration: id, result: result || { level: "INFO", message: "Sync is still running — check back shortly." } });
    } catch {
      setSyncLogs({ integration: id, result: { level: "ERROR", message: "Could not reach the backend integration gateway." } });
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
            const connected = item.status === "Connected" || item.status === "Configured";
            return (
              <Card key={item.id} hover className="flex flex-col justify-between gap-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-zinc-900 flex items-center justify-center text-sm font-semibold text-zinc-300 border border-zinc-800 shrink-0">
                      {(item.name || item.id || "?").slice(0, 2).toUpperCase()}
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

                <p className="text-sm text-zinc-400 leading-relaxed min-h-[40px]">{descFor(item.id)}</p>

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

      {/* Sync result toast */}
      {syncLogs && (
        <div className="fixed bottom-6 right-6 w-96 max-w-[calc(100vw-3rem)] ui-card ui-fade-in shadow-2xl p-4 z-50">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className={cn("w-2 h-2 rounded-full shrink-0",
                syncLogs.result.level === "SUCCESS" ? "bg-emerald-400" : syncLogs.result.level === "ERROR" ? "bg-rose-400" : "bg-amber-400")} />
              <span className="text-sm font-semibold text-zinc-100 truncate">
                {syncLogs.integration.toUpperCase()} sync {syncLogs.result.level === "SUCCESS" ? "passed" : syncLogs.result.level === "ERROR" ? "found issues" : "pending"}
              </span>
            </div>
            <button onClick={() => setSyncLogs(null)} className="text-zinc-500 hover:text-zinc-200 cursor-pointer shrink-0">
              <X size={14} />
            </button>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed mt-2 max-h-64 overflow-y-auto custom-scrollbar">
            {syncLogs.result.message}
          </p>
        </div>
      )}

      {/* Connect modal */}
      <Modal
        open={!!activeIntegration}
        onClose={() => { setActiveIntegration(null); setCredValues({}); }}
        title={activeIntegration ? `Connect ${activeIntegration.name}` : ""}
        description="Save real read-only credentials, then run Sync to pull live control data."
        size="md"
      >
        {activeIntegration && (
          <>
            {oauthIds.includes(activeIntegration.id) && (
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
                    {mode === "api" ? "API Credentials" : "OAuth Web Connection"}
                  </button>
                ))}
              </div>
            )}

            <form onSubmit={handleConnect} className="space-y-4">
              {connectionMode === "api" || !oauthIds.includes(activeIntegration.id) ? (
                <div className="space-y-3">
                  {(fieldsMap[activeIntegration.id] || [{ key: "token", label: "API token", secret: true }]).map((f) => (
                    <Field key={f.key} label={f.label + (f.required === false ? " (optional)" : "")}>
                      {f.multiline ? (
                        <Textarea
                          value={credValues[f.key] || ""}
                          onChange={(e) => setCredValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                          placeholder={f.placeholder || ""}
                          rows={4}
                          className="font-mono resize-none"
                        />
                      ) : (
                        <Input
                          type={f.secret ? "password" : "text"}
                          value={credValues[f.key] || ""}
                          onChange={(e) => setCredValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                          placeholder={f.placeholder || ""}
                          className="font-mono"
                        />
                      )}
                    </Field>
                  ))}
                  <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/5 p-3 rounded-lg border border-amber-500/15">
                    <ShieldAlert size={14} className="shrink-0 text-amber-400 mt-0.5" />
                    <span>Credentials are encrypted with the server BYOK vault. Use read-only audit scopes only.</span>
                  </div>
                </div>
              ) : (
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-xs text-zinc-400 space-y-2">
                  <div className="flex items-center gap-2 font-semibold text-zinc-200">
                    <Cloud size={14} className="text-zinc-400" />
                    OAuth &amp; web redirect mode
                  </div>
                  <p className="leading-relaxed">
                    You&apos;ll be redirected to {activeIntegration.name} to authorize read-only access, then
                    returned here. Prefer the API Credentials tab if you already have a token.
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
