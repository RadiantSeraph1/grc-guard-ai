"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  AlertTriangle,
  Bot,
  CheckCircle,
  Database,
  KeyRound,
  Lock,
  Plug,
  DownloadCloud,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  XCircle
} from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/backend";
const ROLES = ["SuperAdmin", "Admin", "Editor", "Auditor", "Viewer", "Employee"];
const STATUSES = ["Active", "Onboarding", "Offboarding", "Suspended"];
const INTEGRATION_STATUSES = ["Connected", "Configured", "Disconnected", "Error"];
const PROVIDER_DETAILS = {
  local_evidence: { name: "Local Evidence", desc: "Deterministic local rule engine fallback.", url: "", model: "local-evidence" },
  gemini: { name: "Google Gemini", desc: "Google GenAI native adapter.", url: "", model: "gemini-2.5-flash" },
  openai: { name: "OpenAI", desc: "OpenAI chat completions adapter.", url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o" },
  claude: { name: "Anthropic Claude", desc: "Claude Messages API adapter.", url: "", model: "claude-3-5-sonnet-20241022" },
  groq: { name: "Groq", desc: "Low-latency OpenAI-compatible inference.", url: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.3-70b-versatile" },
  openrouter: { name: "OpenRouter", desc: "Multi-provider model routing gateway.", url: "https://openrouter.ai/api/v1/chat/completions", model: "google/gemini-2.5-flash" },
  mistral: { name: "Mistral AI", desc: "Mistral OpenAI-compatible chat endpoint.", url: "https://api.mistral.ai/v1/chat/completions", model: "mistral-large-latest" },
  deepseek: { name: "DeepSeek", desc: "DeepSeek chat and reasoning models.", url: "https://api.deepseek.com/v1/chat/completions", model: "deepseek-chat" },
  perplexity: { name: "Perplexity", desc: "Search-grounded Sonar models.", url: "https://api.perplexity.ai/chat/completions", model: "sonar-pro" },
  xai: { name: "xAI", desc: "Grok API through OpenAI-compatible chat.", url: "https://api.x.ai/v1/chat/completions", model: "grok-3-mini" },
  azure_openai: { name: "Azure OpenAI", desc: "Azure deployment endpoint. Paste full chat completions URL.", url: "https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version=2024-10-21", model: "gpt-4o" },
  ollama: { name: "Ollama", desc: "Local Ollama OpenAI-compatible endpoint.", url: "http://localhost:11434/v1/chat/completions", model: "llama3.1" },
  local: { name: "Local vLLM", desc: "Self-hosted OpenAI-compatible endpoint.", url: "", model: "custom-model" },
  vast_ai: { name: "Vast.ai", desc: "Self-hosted GPU endpoint.", url: "", model: "custom-model" },
  custom: { name: "Custom", desc: "Any OpenAI-compatible chat endpoint.", url: "", model: "custom-model" }
};
const PROVIDER_ORDER = Object.keys(PROVIDER_DETAILS);

export default function SuperAdminPage() {
  const { getToken } = useAuth();
  const [overview, setOverview] = useState(null);
  const [control, setControl] = useState(null);
  const [session, setSession] = useState(null);
  const [activeTab, setActiveTab] = useState("identity");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [integrationSecrets, setIntegrationSecrets] = useState({});
  const [providerDrafts, setProviderDrafts] = useState({});
  const [departmentMove, setDepartmentMove] = useState({ from_department: "", to_department: "" });
  const [newDepartment, setNewDepartment] = useState({ name: "", description: "" });
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    role: "Employee",
    department: "General",
    status: "Active",
    training_completed: false,
    background_check_passed: false
  });

  const authHeaders = async () => {
    let token = "";
    try {
      token = await getToken();
    } catch {
      token = "";
    }
    const superAdminSession = typeof window !== "undefined" ? sessionStorage.getItem("super_admin_session") : "";
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(superAdminSession ? { "X-Super-Admin-Session": superAdminSession } : {})
    };
  };

  const apiRequest = async (path, options = {}) => {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        ...headers,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.detail || "Super admin action failed.");
    }
    return data;
  };

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const headers = await authHeaders();
      const [overviewRes, controlRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/super-admin/overview`, { headers }),
        fetch(`${API_BASE_URL}/api/super-admin/control-plane`, { headers })
      ]);
      const overviewData = await overviewRes.json().catch(() => ({}));
      const controlData = await controlRes.json().catch(() => ({}));
      if (!overviewRes.ok) throw new Error(overviewData.detail || "Super admin access is required.");
      if (!controlRes.ok) throw new Error(controlData.detail || "Could not load control plane.");
      setOverview(overviewData);
      setControl(controlData);
      try {
        const token = await getToken();
        if (token) {
          const sessionRes = await fetch(`${API_BASE_URL}/api/auth/session`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (sessionRes.ok) setSession(await sessionRes.json());
        }
      } catch {}
    } catch (err) {
      setOverview(null);
      setControl(null);
      setError(err.message || "Super admin access is required.");
    } finally {
      setLoading(false);
    }
  };

  const runAction = async (label, action) => {
    setBusy(label);
    setNotice("");
    setError("");
    try {
      const result = await action();
      setNotice(result?.message || "Action completed.");
      await loadData();
    } catch (err) {
      setError(err.message || "Action failed.");
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const departments = useMemo(() => {
    const realDepartments = (control?.departments || []).map((department) => department.name);
    const userDepartments = (control?.users || []).map((user) => user.department || "Unassigned");
    return [...new Set([...realDepartments, ...userDepartments])].sort();
  }, [control]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-8">
        <div className="flex items-center gap-2 text-zinc-400 text-xs">
          <RefreshCw size={14} className="animate-spin" />
          Loading super admin controls...
        </div>
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-8">
        <div className="w-full max-w-md bg-[#121215] border border-zinc-800 rounded-xl p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mx-auto">
            <Lock size={22} className="text-rose-400" />
          </div>
          <h1 className="text-lg font-semibold text-zinc-100">Super Admin Only</h1>
          <p className="text-xs text-zinc-500">Use the hidden super-admin login page to create an access-key session.</p>
          <div className="text-[10px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">{error}</div>
          {session && <div className="text-left text-[10px] text-zinc-500 bg-zinc-950 border border-zinc-800 rounded-lg p-3">Current role: {session.role}</div>}
          <button onClick={() => { window.location.href = "/super-admin/login"; }} className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-950 rounded-lg py-2.5 text-xs font-semibold">
            Use Super Admin Login
          </button>
        </div>
      </div>
    );
  }

  const totals = overview?.totals || {};
  const security = overview?.security || {};

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1500px] mx-auto w-full">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Restricted Platform Console</span>
          <h2 className="text-2xl font-semibold text-zinc-100 tracking-tight mt-0.5">Super Admin Dashboard</h2>
          <p className="text-zinc-400 text-xs mt-0.5">
            Absolute platform control for identity, departments, integrations, AI providers, and operational reset actions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={loadData} className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-200 rounded-lg px-3 py-2 text-xs flex items-center gap-2">
            <RefreshCw size={13} />
            Refresh
          </button>
          <button onClick={() => { sessionStorage.removeItem("super_admin_session"); window.location.href = "/super-admin/login"; }} className="bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 text-zinc-400 rounded-lg px-3 py-2 text-xs">
            Lock Console
          </button>
        </div>
      </div>

      {(notice || error) && (
        <div className={`border rounded-lg p-3 text-xs ${error ? "border-rose-500/30 bg-rose-500/10 text-rose-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"}`}>
          {error || notice}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        <Metric icon={Users} label="Users" value={totals.users} sub={`${totals.departments} departments`} />
        <Metric icon={ShieldCheck} label="Controls" value={totals.controls} sub={`${totals.failing_controls} failing`} />
        <Metric icon={Plug} label="Integrations" value={totals.integrations} sub={`${totals.connected_integrations} connected`} />
        <Metric icon={Database} label="Evidence" value={totals.evidence} sub={`${totals.assets} assets`} />
        <Metric icon={Bot} label="Active AI" value={security.active_ai_provider || "local"} sub={security.byok_configured ? "Vault ready" : "No vault"} />
        <Metric icon={KeyRound} label="Auth Mode" value={security.mock_auth_enabled ? "Mock" : "Live"} sub={security.clerk_configured ? "Clerk JWKS" : "Local"} />
      </div>

      <div className="flex gap-2 border-b border-zinc-850 overflow-x-auto no-scrollbar">
        <TabButton id="identity" label="Identity" icon={Users} activeTab={activeTab} setActiveTab={setActiveTab} />
        <TabButton id="departments" label="Departments" icon={SlidersHorizontal} activeTab={activeTab} setActiveTab={setActiveTab} />
        <TabButton id="integrations" label="Integrations" icon={Plug} activeTab={activeTab} setActiveTab={setActiveTab} />
        <TabButton id="ai" label="AI Providers" icon={Bot} activeTab={activeTab} setActiveTab={setActiveTab} />
        <TabButton id="operations" label="Operations" icon={AlertTriangle} activeTab={activeTab} setActiveTab={setActiveTab} />
      </div>

      {activeTab === "identity" && (
        <section className="space-y-5">
          <div className="bg-[#121215] border border-zinc-800 rounded-lg p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
              <HeaderInline title="Create User" subtitle="Provision a local platform user or sync users created in Clerk." />
              <button
                disabled={Boolean(busy) || !security.clerk_secret_configured}
                onClick={() => runAction("sync-clerk-users", () => apiRequest("/api/super-admin/clerk/sync-users", { method: "POST" }))}
                className="bg-zinc-100 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-950 rounded-lg px-4 py-2.5 text-xs font-semibold flex items-center justify-center gap-2"
                title={security.clerk_secret_configured ? "Import users from Clerk" : "Set CLERK_SECRET_KEY on the backend to enable Clerk sync"}
              >
                <DownloadCloud size={14} />
                Sync Clerk Users
              </button>
            </div>
            {!security.clerk_secret_configured && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                Clerk sync needs `CLERK_SECRET_KEY` in the backend environment. Users created in Clerk appear here after syncing or after their first login.
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <Input label="Name" value={newUser.name} onChange={(value) => setNewUser((prev) => ({ ...prev, name: value }))} placeholder="Full name" />
              <Input label="Email" value={newUser.email} onChange={(value) => setNewUser((prev) => ({ ...prev, email: value }))} placeholder="name@company.com" />
              <Select label="Role" value={newUser.role} onChange={(value) => setNewUser((prev) => ({ ...prev, role: value }))} options={ROLES} />
              <Input label="Department" value={newUser.department} onChange={(value) => setNewUser((prev) => ({ ...prev, department: value }))} list="create-user-departments" placeholder="Department" />
              <datalist id="create-user-departments">{departments.map((dept) => <option key={dept} value={dept} />)}</datalist>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-zinc-400"><Toggle checked={newUser.training_completed} onChange={(value) => setNewUser((prev) => ({ ...prev, training_completed: value }))} /> Training complete</label>
              <label className="flex items-center gap-2 text-xs text-zinc-400"><Toggle checked={newUser.background_check_passed} onChange={(value) => setNewUser((prev) => ({ ...prev, background_check_passed: value }))} /> Background checked</label>
              <button
                disabled={Boolean(busy) || !newUser.name.trim() || !newUser.email.trim()}
                onClick={() => runAction("create-user", async () => {
                  const result = await apiRequest("/api/super-admin/users", { method: "POST", body: JSON.stringify(newUser) });
                  setNewUser({ name: "", email: "", role: "Employee", department: "General", status: "Active", training_completed: false, background_check_passed: false });
                  return result;
                })}
                className="sm:ml-auto bg-zinc-100 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-950 rounded-lg px-4 py-2.5 text-xs font-semibold"
              >
                Create User
              </button>
            </div>
          </div>

          <div className="bg-[#121215] border border-zinc-800 rounded-lg overflow-hidden">
            <Header title="Real Users" subtitle="Promote, demote, suspend, and reassign every platform user." />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[920px]">
                <thead className="bg-zinc-950/60 text-[10px] uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Department</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Training</th>
                    <th className="px-4 py-3">Background</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(control?.users || []).map((user) => (
                    <UserRow key={user.id} user={user} busy={busy} runAction={runAction} apiRequest={apiRequest} departments={departments} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {activeTab === "departments" && (
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 bg-[#121215] border border-zinc-800 rounded-lg overflow-hidden">
            <Header title="Real Departments" subtitle="Company-wide control mapping by department, including empty departments." />
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="bg-zinc-950/60 text-[10px] uppercase tracking-wider text-zinc-500">
                  <tr><th className="px-4 py-3">Department</th><th className="px-4 py-3">Description</th><th className="px-4 py-3">Users</th><th className="px-4 py-3">Controls</th><th className="px-4 py-3">Risks</th><th className="px-4 py-3">Open</th></tr>
                </thead>
                <tbody>
                  {(overview?.departments || []).map((dept) => (
                    <tr key={dept.name} className="border-t border-zinc-850">
                      <td className="px-4 py-3 font-semibold text-zinc-200">{dept.name}</td>
                      <td className="px-4 py-3 text-zinc-500 max-w-[260px]">{dept.description || "No description"}</td>
                      <td className="px-4 py-3 text-zinc-400">{dept.users}</td>
                      <td className="px-4 py-3 text-zinc-400">{dept.controls}</td>
                      <td className="px-4 py-3 text-zinc-400">{dept.risks}</td>
                      <td className="px-4 py-3 text-zinc-400">{dept.open_risks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="space-y-5">
            <div className="bg-[#121215] border border-zinc-800 rounded-lg p-5 space-y-4">
              <HeaderInline title="Create Department" subtitle="Create a department before assigning users to it." />
              <Input label="Name" value={newDepartment.name} onChange={(value) => setNewDepartment((prev) => ({ ...prev, name: value }))} placeholder="Department name" />
              <label className="block space-y-1">
                <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Description</span>
                <textarea
                  value={newDepartment.description}
                  onChange={(e) => setNewDepartment((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="What this department owns"
                  className="w-full min-h-24 bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-200 outline-none focus:border-zinc-600"
                />
              </label>
              <button
                disabled={Boolean(busy) || !newDepartment.name.trim()}
                onClick={() => runAction("create-department", async () => {
                  const result = await apiRequest("/api/super-admin/departments", { method: "POST", body: JSON.stringify(newDepartment) });
                  setNewDepartment({ name: "", description: "" });
                  return result;
                })}
                className="w-full bg-zinc-100 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-950 rounded-lg py-2.5 text-xs font-semibold"
              >
                Create Department
              </button>
            </div>

            <div className="bg-[#121215] border border-zinc-800 rounded-lg p-5 space-y-4">
              <HeaderInline title="Bulk Department Move" subtitle="Move all users from one department to another." />
              <Select label="From" value={departmentMove.from_department} onChange={(value) => setDepartmentMove((prev) => ({ ...prev, from_department: value }))} options={departments} />
              <Input label="To Department" value={departmentMove.to_department} onChange={(value) => setDepartmentMove((prev) => ({ ...prev, to_department: value }))} list="move-departments" placeholder="Target department" />
              <datalist id="move-departments">{departments.map((dept) => <option key={dept} value={dept} />)}</datalist>
              <button
                disabled={busy || !departmentMove.from_department || !departmentMove.to_department}
                onClick={() => runAction("move-department", () => apiRequest("/api/super-admin/departments/move", { method: "POST", body: JSON.stringify(departmentMove) }))}
                className="w-full bg-zinc-100 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-950 rounded-lg py-2.5 text-xs font-semibold"
              >
                Move Department Users
              </button>
            </div>
          </div>
        </section>
      )}

      {activeTab === "integrations" && (
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {(control?.integrations || []).map((item) => (
            <div key={item.id} className="bg-[#121215] border border-zinc-800 rounded-lg p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="text-sm font-semibold text-zinc-100">{item.name}</h3><p className="text-[10px] text-zinc-500 mt-1">{item.category}</p></div>
                <StatusBadge status={item.status} />
              </div>
              <div className="text-[10px] text-zinc-500">Credentials: {item.has_credentials ? "Stored" : "Not configured"}</div>
              <textarea
                value={integrationSecrets[item.id] || ""}
                onChange={(e) => setIntegrationSecrets((prev) => ({ ...prev, [item.id]: e.target.value }))}
                placeholder="Paste JSON credentials or leave blank to disconnect"
                className="w-full min-h-20 bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-200 outline-none focus:border-zinc-600"
              />
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => runAction(`save-${item.id}`, () => apiRequest(`/api/super-admin/integrations/${item.id}`, { method: "PATCH", body: JSON.stringify({ credentials: integrationSecrets[item.id] || "" }) }))} className="bg-zinc-100 text-zinc-950 rounded-lg py-2 text-xs font-semibold flex items-center justify-center gap-2">
                  <Save size={13} /> Save
                </button>
                <button onClick={() => runAction(`sync-${item.id}`, () => apiRequest(`/api/super-admin/integrations/${item.id}/sync`, { method: "POST" }))} className="bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-lg py-2 text-xs font-semibold flex items-center justify-center gap-2">
                  <RefreshCw size={13} /> Sync
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {INTEGRATION_STATUSES.map((status) => (
                  <button key={status} onClick={() => runAction(`${item.id}-${status}`, () => apiRequest(`/api/super-admin/integrations/${item.id}`, { method: "PATCH", body: JSON.stringify({ status }) }))} className="bg-zinc-950 border border-zinc-800 hover:border-zinc-600 text-zinc-400 rounded-lg py-2 text-[10px]">
                    Set {status}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {activeTab === "ai" && (
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {([...(control?.ai_providers || [])].sort((a, b) => PROVIDER_ORDER.indexOf(a.id) - PROVIDER_ORDER.indexOf(b.id))).map((provider) => {
            const draft = providerDrafts[provider.id] || {};
            const details = PROVIDER_DETAILS[provider.id] || { name: provider.id, desc: "Custom provider.", url: "", model: "custom-model" };
            const builtInProvider = provider.id === "local_evidence";
            return (
              <div key={provider.id} className="bg-[#121215] border border-zinc-800 rounded-lg p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div><h3 className="text-sm font-semibold text-zinc-100">{details.name}</h3><p className="text-[10px] text-zinc-500 mt-1">{details.desc}</p><p className="text-[10px] text-zinc-600 mt-1">{builtInProvider ? "Built in, no external key required" : provider.has_api_key ? "API key stored" : "No API key stored"}</p></div>
                  {provider.is_active ? <span className="text-[9px] bg-emerald-500/10 text-emerald-400 rounded px-2 py-1 font-semibold">Active</span> : <span className="text-[9px] bg-zinc-800 text-zinc-500 rounded px-2 py-1 font-semibold">Standby</span>}
                </div>
                {!builtInProvider && (
                  <>
                    <Input label="Base URL" value={draft.base_url ?? provider.base_url ?? ""} onChange={(value) => setProviderDrafts((prev) => ({ ...prev, [provider.id]: { ...(prev[provider.id] || {}), base_url: value } }))} placeholder={details.url || "Native adapter or custom endpoint"} />
                    <Input label="Model" value={draft.model_override ?? provider.model_override ?? ""} onChange={(value) => setProviderDrafts((prev) => ({ ...prev, [provider.id]: { ...(prev[provider.id] || {}), model_override: value } }))} placeholder={details.model} />
                    <Input label="API Key" type="password" value={draft.api_key ?? ""} onChange={(value) => setProviderDrafts((prev) => ({ ...prev, [provider.id]: { ...(prev[provider.id] || {}), api_key: value } }))} placeholder="Paste new key" />
                  </>
                )}
                {builtInProvider && (
                  <div className="rounded-lg border border-zinc-850 bg-zinc-950/60 p-3 text-xs text-zinc-500 leading-relaxed">
                    Local Evidence is always available as the deterministic fallback. Activate it when you want the app to run without external LLM calls.
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {!builtInProvider && <button onClick={() => runAction(`save-ai-${provider.id}`, () => apiRequest(`/api/super-admin/ai-providers/${provider.id}`, { method: "PATCH", body: JSON.stringify(draft) }))} className="bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-lg py-2 text-xs font-semibold">Save</button>}
                  <button onClick={() => runAction(`activate-ai-${provider.id}`, () => apiRequest(`/api/super-admin/ai-providers/${provider.id}`, { method: "PATCH", body: JSON.stringify({ ...draft, activate: true }) }))} className="bg-zinc-100 text-zinc-950 rounded-lg py-2 text-xs font-semibold">Activate</button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {activeTab === "operations" && (
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 bg-[#121215] border border-zinc-800 rounded-lg p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-100">Live Operational Signals</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Signal label="Failing Controls" value={(control?.controls || []).filter((item) => item.status === "Failing").length} tone="rose" />
              <Signal label="Open Risks" value={(control?.risks || []).filter((item) => item.status === "Open").length} tone="amber" />
              <Signal label="Failing Assets" value={(control?.assets || []).filter((item) => item.status === "Failing").length} tone="rose" />
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {(control?.controls || []).filter((item) => item.status === "Failing").slice(0, 8).map((item) => (
                <div key={item.id} className="border border-zinc-850 bg-zinc-950/40 rounded-lg p-3">
                  <div className="text-[10px] text-zinc-500">{item.code}</div>
                  <div className="text-xs text-zinc-200 font-semibold mt-1">{item.title}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-5">
            <div className="bg-[#121215] border border-rose-500/30 rounded-lg p-5 space-y-4">
              <div className="w-10 h-10 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                <AlertTriangle size={18} className="text-rose-400" />
              </div>
              <h3 className="text-sm font-semibold text-zinc-100">Reset to Empty</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">Permanently clears all operational data — controls, risks, vendors, assets, policies, evidence, and the ingested corpus — and resets every connector to Disconnected. Users, departments, and configuration are preserved. The organization returns to an empty state.</p>
              <button onClick={() => runAction("reset-data", () => apiRequest("/api/super-admin/reset-data", { method: "POST" }))} className="w-full bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 rounded-lg py-2.5 text-xs font-semibold flex items-center justify-center gap-2">
                <RotateCcw size={13} /> Clear All Data
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function UserRow({ user, busy, runAction, apiRequest, departments }) {
  const [draft, setDraft] = useState({
    role: user.role || "Employee",
    department: user.department || "General",
    status: user.status || "Active",
    training_completed: Boolean(user.training_completed),
    background_check_passed: Boolean(user.background_check_passed)
  });

  return (
    <tr className="border-t border-zinc-850">
      <td className="px-4 py-3"><div className="font-semibold text-zinc-200">{user.name}</div><div className="text-[10px] text-zinc-500">{user.email}</div></td>
      <td className="px-4 py-3"><Select value={draft.role} onChange={(value) => setDraft((prev) => ({ ...prev, role: value }))} options={ROLES} compact /></td>
      <td className="px-4 py-3"><Input value={draft.department} onChange={(value) => setDraft((prev) => ({ ...prev, department: value }))} list="departments" compact /><datalist id="departments">{departments.map((dept) => <option key={dept} value={dept} />)}</datalist></td>
      <td className="px-4 py-3"><Select value={draft.status} onChange={(value) => setDraft((prev) => ({ ...prev, status: value }))} options={STATUSES} compact /></td>
      <td className="px-4 py-3"><Toggle checked={draft.training_completed} onChange={(value) => setDraft((prev) => ({ ...prev, training_completed: value }))} /></td>
      <td className="px-4 py-3"><Toggle checked={draft.background_check_passed} onChange={(value) => setDraft((prev) => ({ ...prev, background_check_passed: value }))} /></td>
      <td className="px-4 py-3">
        <button disabled={Boolean(busy)} onClick={() => runAction(`user-${user.id}`, () => apiRequest(`/api/super-admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify(draft) }))} className="bg-zinc-100 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-950 rounded-lg px-3 py-2 text-xs font-semibold">
          Save
        </button>
      </td>
    </tr>
  );
}

function Header({ title, subtitle }) {
  return <div className="p-5 border-b border-zinc-850"><h3 className="text-sm font-semibold text-zinc-100">{title}</h3><p className="text-[10px] text-zinc-500 mt-1">{subtitle}</p></div>;
}

function HeaderInline({ title, subtitle }) {
  return <div><h3 className="text-sm font-semibold text-zinc-100">{title}</h3><p className="text-[10px] text-zinc-500 mt-1">{subtitle}</p></div>;
}

function TabButton({ id, label, icon: Icon, activeTab, setActiveTab }) {
  const active = activeTab === id;
  return <button onClick={() => setActiveTab(id)} className={`px-3 py-3 text-xs flex items-center gap-2 border-b ${active ? "border-zinc-100 text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}><Icon size={14} />{label}</button>;
}

function Metric({ icon: Icon, label, value, sub }) {
  return <div className="bg-[#121215] border border-zinc-800 rounded-lg p-4"><div className="flex items-center justify-between"><span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{label}</span><Icon size={15} className="text-zinc-500" /></div><div className="text-xl font-semibold text-zinc-100 mt-3 truncate">{value ?? 0}</div><div className="text-[10px] text-zinc-500 mt-2">{sub}</div></div>;
}

function Input({ label, value, onChange, placeholder, type = "text", compact = false, list }) {
  return <label className="block space-y-1">{label && <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{label}</span>}<input list={list} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`w-full bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 outline-none focus:border-zinc-600 ${compact ? "px-2 py-1.5 text-[11px]" : "px-3 py-2.5 text-xs"}`} /></label>;
}

function Select({ label, value, onChange, options, compact = false }) {
  return <label className="block space-y-1">{label && <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{label}</span>}<select value={value} onChange={(e) => onChange(e.target.value)} className={`w-full bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 outline-none focus:border-zinc-600 ${compact ? "px-2 py-1.5 text-[11px]" : "px-3 py-2.5 text-xs"}`}><option value="">Select</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function Toggle({ checked, onChange }) {
  return <button onClick={() => onChange(!checked)} className={`w-8 h-5 rounded-full border p-0.5 transition ${checked ? "bg-emerald-500/20 border-emerald-500/40" : "bg-zinc-900 border-zinc-700"}`}><span className={`block w-4 h-4 rounded-full transition ${checked ? "translate-x-3 bg-emerald-400" : "bg-zinc-500"}`} /></button>;
}

function StatusBadge({ status }) {
  const tone = status === "Connected" ? "text-emerald-400 bg-emerald-500/10" : status === "Error" ? "text-rose-400 bg-rose-500/10" : status === "Configured" ? "text-sky-400 bg-sky-500/10" : "text-zinc-500 bg-zinc-800";
  return <span className={`text-[9px] rounded px-2 py-1 font-semibold ${tone}`}>{status}</span>;
}

function Signal({ label, value, tone }) {
  const Icon = value > 0 ? AlertTriangle : CheckCircle;
  const color = tone === "rose" && value > 0 ? "text-rose-400" : tone === "amber" && value > 0 ? "text-amber-400" : "text-emerald-400";
  return <div className="border border-zinc-850 bg-zinc-950/40 rounded-lg p-4"><Icon size={16} className={color} /><div className="text-2xl font-semibold text-zinc-100 mt-2">{value}</div><div className="text-[10px] text-zinc-500 mt-1">{label}</div></div>;
}
