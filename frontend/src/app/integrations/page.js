"use client";

import { useState, useEffect } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { 
  Cloud, Key, Terminal, Code, Users, Radio, 
  RotateCw, PlusCircle, AlertCircle, X, ShieldAlert,
  Server, Laptop
} from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/backend";

// Per-connector presentation + credential hints. Connectors themselves come from
// the backend catalog (/api/integrations); this only drives icons/help text.
const CONNECTOR_META = {
  aws: { emoji: "☁️", desc: "Audits S3 bucket encryption and storage security configuration.",
    label: "AWS Access Credentials", ph: '{"aws_access_key_id":"...","aws_secret_access_key":"...","bucket_name":"..."}' },
  gcp: { emoji: "🌥️", desc: "Audits GCS bucket encryption and public-access prevention.",
    label: "GCP Service Account JSON", ph: '{"service_account_json":"{...}","bucket_name":"my-bucket","project_id":"my-proj"}' },
  azure: { emoji: "🟦", desc: "Audits Storage Account secure-transfer and encryption settings.",
    label: "Azure Service Principal", ph: '{"tenant_id":"...","client_id":"...","client_secret":"...","subscription_id":"...","resource_group":"...","account_name":"..."}' },
  okta: { emoji: "🔑", desc: "Retrieves user rosters and verifies MFA factor enrollment.",
    label: "Okta API Token / Org URL", ph: '{"org_url":"https://dev-xxxxx.okta.com","token":"..."}' },
  auth0: { emoji: "🛡️", desc: "Audits directory users, MFA Guardian enrollment, login logs, and roles.",
    label: "Auth0 M2M Credentials", ph: '{"domain":"your-tenant.us.auth0.com","client_id":"...","client_secret":"..."}' },
  entra: { emoji: "🟦", desc: "Audits Entra ID users and MFA via Microsoft Graph.",
    label: "Entra (Graph) App Registration", ph: '{"tenant_id":"...","client_id":"...","client_secret":"..."}' },
  google_workspace: { emoji: "🅖", desc: "Audits Workspace users and 2-Step Verification enrollment.",
    label: "Workspace Service Account", ph: '{"service_account_json":"{...}","admin_email":"admin@yourco.com"}' },
  github: { emoji: "💻", desc: "Evaluates branch protection and pull request review rules.",
    label: "GitHub Personal Access Token", ph: '{"token":"ghp_...","owner":"your-org","repo":"your-repo","branch":"main"}' },
  snyk: { emoji: "🐶", desc: "Audits open critical/high vulnerabilities across monitored projects.",
    label: "Snyk API Token + Org", ph: '{"token":"...","org_id":"..."}' },
  crowdstrike: { emoji: "🦅", desc: "Audits endpoint sensor coverage and detection posture.",
    label: "CrowdStrike API Client", ph: '{"client_id":"...","client_secret":"...","base_url":"https://api.crowdstrike.com"}' },
  jamf: { emoji: "📱", desc: "Validates managed Mac enrollment and FileVault disk encryption.",
    label: "Jamf Pro API Client", ph: '{"base_url":"https://yourorg.jamfcloud.com","client_id":"...","client_secret":"..."}' },
  workday: { emoji: "👥", desc: "Syncs active worker roster via a RaaS report endpoint.",
    label: "Workday RaaS Report", ph: '{"report_url":"https://...","username":"ISU","password":"..."}' },
};
const metaFor = (id) => CONNECTOR_META[id] || { emoji: "🔌", desc: "Connect this system to pull live compliance evidence.", label: "API Credentials (JSON)", ph: '{"...":"..."}' };

export default function IntegrationsPage() {
  const { getToken } = useAuth();
  const { user } = useUser();
  
  const [integrations, setIntegrations] = useState([]);
  const [category, setCategory] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [syncLogs, setSyncLogs] = useState(null);
  const [activeIntegration, setActiveIntegration] = useState(null);
  const [credentials, setCredentials] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [syncingId, setSyncingId] = useState(null);
  const [connectionMode, setConnectionMode] = useState("api");

  const fetchIntegrations = async () => {
    try {
      const token = await getToken();
      const headers = { "Authorization": `Bearer ${token}` };
      const res = await fetch(`${API_BASE_URL}/api/integrations`, { headers });
      if (!res.ok) {
        throw new Error(`HTTP error: ${res.status}`);
      }
      const data = await res.json();
      if (!Array.isArray(data)) {
        throw new Error("Invalid response format: expected an array.");
      }
      setIntegrations(data);
    } catch (err) {
      console.warn("Backend unavailable; the connector catalog could not be loaded.");
      setIntegrations([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Check URL query parameters for successful OAuth callbacks
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const status = params.get("status");
      const id = params.get("id");
      if (status === "success" && id) {
        alert(`Successfully authorized ${id.toUpperCase()} via OAuth redirect!`);
        // Clean URL parameters from the browser address bar
        const newUrl = window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
      }
    }
    fetchIntegrations();
  }, []);

  const intTime = () => Math.floor(Date.now() / 1000);

  const handleConnect = async (e) => {
    e.preventDefault();
    
    if (connectionMode === "oauth") {
      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE_URL}/api/integrations/${activeIntegration.id}/authorize`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
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

    setConnecting(true);
    const apiCreds = credentials.trim();
    if (!apiCreds) {
      alert("Enter real read-only credentials before connecting this system.");
      setConnecting(false);
      return;
    }

    try {
      const token = await getToken();
      const headers = { 
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      };
      const payload = {
        id: activeIntegration.id,
        credentials: connectionMode === "api" ? apiCreds : ""
      };
      
      const res = await fetch(`${API_BASE_URL}/api/integrations/connect`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || `HTTP ${res.status}`);
      }
      if (data.status === "success") {
        setActiveIntegration(null);
        setCredentials("");
        fetchIntegrations();
      }
    } catch (err) {
      alert(`Failed to connect integration: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleSync = async (id) => {
    setSyncingId(id);
    try {
      const token = await getToken();
      const headers = { "Authorization": `Bearer ${token}` };
      const res = await fetch(`${API_BASE_URL}/api/integrations/${id}/sync`, {
        method: "POST",
        headers
      });
      const data = await res.json();
      if (data.status === "sync_started") {
        // fetch sync logs
        const logRes = await fetch(`${API_BASE_URL}/api/integrations/${id}/logs`, { headers });
        const logData = await logRes.json();
        setSyncLogs({ integration: id, entries: logData });
        fetchIntegrations();
      }
    } catch (err) {
      console.warn("Fallback sync run.");
      setSyncLogs({
        integration: id,
        entries: [
          { timestamp: intTime(), level: "ERROR", message: "Could not reach the backend integration gateway. No local fallback data was used." }
        ]
      });
    } finally {
      setSyncingId(null);
    }
  };

  const getCategoryIcon = (cat) => {
    switch(cat.toUpperCase()) {
      case "CLOUD": return <Cloud size={16} />;
      case "IDENTITY": return <Key size={16} />;
      case "DEVELOPER": return <Code size={16} />;
      case "HRIS": return <Users size={16} />;
      case "EDR": return <Laptop size={16} />;
      default: return <Server size={16} />;
    }
  };

  const filtered = Array.isArray(integrations)
    ? (category === "ALL" ? integrations : integrations.filter(i => i?.category?.toUpperCase() === category))
    : [];

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto w-full relative">
      
      {/* Title */}
      <div>
        <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">System Connectors</span>
        <h2 className="text-2xl font-semibold text-zinc-100 tracking-tight mt-0.5">Integrations Center</h2>
        <p className="text-zinc-400 text-xs mt-0.5">
          Securely connect GRC Guard AI to your cloud services, repository settings, identity managers, and HR systems.
        </p>
      </div>

      {/* Categories filter bar */}
      <div className="flex border-b border-zinc-800/80 space-x-6">
        {["ALL", "CLOUD", "IDENTITY", "DEVELOPER", "EDR", "HRIS"].map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`pb-3 font-semibold text-xs tracking-wider uppercase border-b-2 cursor-pointer transition-all ${
              category === cat 
                ? "border-zinc-300 text-zinc-200" 
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Grid of integrations */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((item) => (
          <div key={item.id} className="bg-[#121215] border border-zinc-800/80 rounded-xl p-6 flex flex-col justify-between space-y-6 shadow-sm">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 rounded-xl bg-zinc-900 flex items-center justify-center text-2xl border border-zinc-800 shadow-sm">
                  {metaFor(item.id).emoji}
                </div>
                <div>
                  <h3 className="font-semibold text-zinc-200 text-base leading-snug">{item.name}</h3>
                  <span className="flex items-center text-[10px] text-zinc-500 font-semibold tracking-wide mt-0.5">
                    {getCategoryIcon(item.category)}
                    <span className="ml-1.5 uppercase">{item.category}</span>
                  </span>
                </div>
              </div>
              <span className={`text-[10px] font-semibold py-0.5 px-2 rounded ${
                item.status === "Connected" 
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                  : item.status === "Configured"
                  ? "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                  : item.status === "Error"
                  ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                  : "bg-zinc-900 text-zinc-400 border border-zinc-800"
              }`}>
                {item.status}
              </span>
            </div>

            <div className="text-xs text-zinc-400 leading-relaxed min-h-[40px]">
              {metaFor(item.id).desc}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-zinc-800/50 text-xs">
              <span className="text-zinc-500">
                {item.last_sync 
                  ? `Synced ${new Date(item.last_sync * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`
                  : "Never Synced"}
              </span>
              
              <div className="flex items-center space-x-2">
                {item.status === "Connected" || item.status === "Configured" ? (
                  <>
                    <button
                      onClick={() => handleSync(item.id)}
                      disabled={syncingId === item.id}
                      className="text-zinc-200 hover:text-zinc-100 font-semibold border border-zinc-800 bg-zinc-900 py-1.5 px-3 rounded-lg hover:bg-zinc-800 cursor-pointer active:scale-95 transition-all text-xs"
                    >
                      {syncingId === item.id ? "Syncing..." : "Sync Now"}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => { setActiveIntegration(item); setConnectionMode("api"); }}
                    className="bg-zinc-100 hover:bg-zinc-200 text-zinc-900 font-semibold py-1.5 px-3.5 rounded-lg cursor-pointer active:scale-95 transition-all text-xs"
                  >
                    Connect
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Sync Logs Widget Overlay */}
      {syncLogs && (
        <div className="fixed bottom-6 right-6 w-96 bg-[#121215] border border-zinc-850 rounded-xl shadow-2xl p-4 z-50 text-xs">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-3">
            <span className="font-semibold text-zinc-200 flex items-center">
              <Terminal size={14} className="mr-1.5 text-zinc-400" />
              Sync Output: {syncLogs.integration.toUpperCase()}
            </span>
            <button 
              onClick={() => setSyncLogs(null)}
              className="text-zinc-500 hover:text-zinc-200 cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
          <div className="font-mono bg-[#09090b] p-3 rounded-lg h-44 overflow-y-auto space-y-1.5 text-zinc-350 text-[10px] custom-scrollbar border border-zinc-800/80">
            {syncLogs.entries.map((log, idx) => (
              <div key={idx} className="flex items-start">
                <span className={`font-semibold mr-1.5 ${
                  log.level === "SUCCESS" ? "text-emerald-450" : log.level === "WARNING" ? "text-amber-450" : "text-zinc-450"
                }`}>
                  [{log.level}]
                </span>
                <span className="break-all text-zinc-300">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Credentials Input Modal */}
      {activeIntegration && (
        <div className="fixed inset-0 bg-[#09090b]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#121215] border border-zinc-800/80 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-6 relative">
            <button 
              onClick={() => { setActiveIntegration(null); setCredentials(""); }}
              className="absolute right-4 top-4 text-zinc-500 hover:text-zinc-200 cursor-pointer"
            >
              <X size={16} />
            </button>

            <div className="space-y-2">
              <h3 className="font-semibold text-zinc-200 text-xl">Connect {activeIntegration.name}</h3>
              <p className="text-zinc-400 text-xs leading-relaxed">
                Save real read-only API credentials, then run Sync to pull live control data from the external system.
              </p>
            </div>

            {/* Connection Mode Selection Tab */}
            <div className="flex border border-zinc-800 rounded-lg overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setConnectionMode("api")}
                className={`flex-1 py-2 font-semibold cursor-pointer transition-all ${
                  connectionMode === "api"
                    ? "bg-zinc-800 text-zinc-200 border-r border-zinc-800"
                    : "text-zinc-500 hover:text-zinc-350 border-r border-zinc-800"
                }`}
              >
                🔑 API Credentials
              </button>
              <button
                type="button"
                onClick={() => setConnectionMode("oauth")}
                className={`flex-1 py-2 font-semibold cursor-pointer transition-all ${
                  connectionMode === "oauth"
                    ? "bg-zinc-800 text-zinc-200"
                    : "text-zinc-500 hover:text-zinc-350"
                }`}
              >
                🌐 OAuth Web Connection
              </button>
            </div>

            <form onSubmit={handleConnect} className="space-y-4">
              {connectionMode === "api" ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
                    {metaFor(activeIntegration.id).label}
                  </label>
                  <textarea
                    value={credentials}
                    onChange={(e) => setCredentials(e.target.value)}
                    placeholder={metaFor(activeIntegration.id).ph}
                    rows={4}
                    className="w-full bg-[#09090b] border border-zinc-800 hover:border-zinc-700 focus:border-zinc-500 text-zinc-100 rounded-lg p-3 text-xs placeholder-zinc-650 focus:outline-none transition-all resize-none font-mono"
                  />
                  <div className="flex items-center space-x-2 text-[10px] text-amber-500/95 bg-amber-500/5 p-3 rounded-lg border border-amber-500/15">
                    <ShieldAlert size={14} className="shrink-0 text-amber-500" />
                    <span>Credentials are encrypted with the server BYOK vault. Use read-only audit scopes only.</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5 bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-xs text-zinc-350 space-y-2">
                  <div className="flex items-center space-x-2 font-semibold text-zinc-200">
                    <Cloud size={14} className="shrink-0 text-zinc-450" />
                    <span>OAuth & Web Redirect Connection Mode</span>
                  </div>
                  <p className="leading-relaxed text-[11px] text-zinc-400">
                    GitHub can use OAuth when GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are configured on the backend. Other systems use API credentials.
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={connecting}
                className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-900 font-semibold py-2 px-4 rounded-lg cursor-pointer active:scale-95 transition-all text-xs flex items-center justify-center space-x-2 shadow-sm"
              >
                <span>{connecting ? "Verifying..." : connectionMode === "api" ? `Save ${activeIntegration.name} Credentials` : `Authorize Web Connection...`}</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}





