"use client";

import { useState, useEffect, useCallback } from "react";
import { Cpu, Key, CheckCircle2, X, Check, ShieldAlert, AlertTriangle } from "lucide-react";
import { useApi } from "../lib/api";
import {
  PageContainer, PageHeader, Card, Badge, Button, Skeleton, Modal, Field, Input, cn,
} from "../components/ui";

const PROVIDER_DESC = {
  gemini: "Google Vertex AI Gemini model. Authenticates via Application Default Credentials (Workload Identity) — no API key needed.",
};
const NO_KEY_REQUIRED = ["gemini"];

const TABS = [
  { id: "ai", label: "AI Gateway", icon: Cpu },
  { id: "byok", label: "Data Protection (BYOK)", icon: Key },
];

export default function SettingsPage() {
  const api = useApi();
  const [activeTab, setActiveTab] = useState("ai");
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [configuringProvider, setConfiguringProvider] = useState(null);

  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelOverride, setModelOverride] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const [byokKey, setByokKey] = useState("");
  const [byokSaved, setByokSaved] = useState(false);

  const fetchProviders = useCallback(async () => {
    try {
      const data = await api.get("/api/settings/ai-providers");
      setProviders(Array.isArray(data) ? data : []);
    } catch {
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const handleSaveProvider = async (e) => {
    e.preventDefault();
    if (!configuringProvider) return;
    setSaving(true);
    try {
      await api.post(`/api/settings/ai-providers/${configuringProvider.id}`, {
        api_key: apiKey,
        base_url: baseUrl || null,
        model_override: modelOverride || null,
      });
      setConfiguringProvider(null);
      setApiKey(""); setBaseUrl(""); setModelOverride("");
      await fetchProviders();
    } catch (err) {
      alert(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleActivateProvider = async (id) => {
    setError(null);
    setSuccessMessage(null);
    try {
      await api.post(`/api/settings/ai-providers/${id}/activate`);
      setSuccessMessage(`${id.replace("_", " ").toUpperCase()} activated successfully.`);
      setTimeout(() => setSuccessMessage(null), 3000);
      await fetchProviders();
    } catch (err) {
      setError(err.message || `Failed to activate ${id.toUpperCase()}. Configure credentials first.`);
      setTimeout(() => setError(null), 6000);
    }
  };

  const handleSaveByok = (e) => {
    e.preventDefault();
    if (!byokKey.trim()) return;
    localStorage.setItem("grc_byok_key", byokKey);
    setByokSaved(true);
    setTimeout(() => setByokSaved(false), 2000);
  };

  const activeProvider = providers.find((p) => p.is_active);

  return (
    <PageContainer>
      <PageHeader eyebrow="Company Administration" title="Settings" description="Configure security variables, cryptographic keys, and active auditor models." />

      <div className="flex border-b border-zinc-800 gap-6 overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 pb-2.5 text-xs font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap",
                activeTab === tab.id ? "border-indigo-400 text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-300"
              )}
            >
              <Icon size={14} /> {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "ai" && (
        <div className="space-y-5 ui-fade-in">
          {activeProvider && (
            <div className="ui-card px-4 py-2.5 text-xs flex items-center justify-between font-mono">
              <span className="text-zinc-400">Active provider</span>
              <Badge variant="accent">{activeProvider.id.replace("_", " ").toUpperCase()}</Badge>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2.5 bg-rose-500/8 border border-rose-500/20 text-rose-400 px-4 py-3 rounded-lg text-xs">
              <AlertTriangle size={14} className="shrink-0" />
              <span className="flex-1 font-medium">{error}</span>
              <button onClick={() => setError(null)} className="cursor-pointer"><X size={14} /></button>
            </div>
          )}
          {successMessage && (
            <div className="flex items-center gap-2.5 bg-emerald-500/8 border border-emerald-500/20 text-emerald-400 px-4 py-3 rounded-lg text-xs">
              <CheckCircle2 size={14} className="shrink-0" />
              <span className="flex-1 font-medium">{successMessage}</span>
              <button onClick={() => setSuccessMessage(null)} className="cursor-pointer"><X size={14} /></button>
            </div>
          )}

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {providers.map((p) => {
                const canActivate = NO_KEY_REQUIRED.includes(p.id) || !!p.api_key;
                return (
                  <Card key={p.id} className={cn("flex flex-col justify-between gap-4", p.is_active && "ring-1 ring-indigo-500/40 border-indigo-500/40")}>
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-semibold text-zinc-100 text-sm uppercase tracking-wide">{p.id.replace("_", " ")}</h4>
                        <span className="text-xs text-zinc-500 font-mono mt-0.5 block">VERTEX_AI_ADAPTER</span>
                      </div>
                      {p.is_active && <CheckCircle2 size={15} className="text-indigo-400" />}
                    </div>
                    <p className="text-xs text-zinc-500 leading-normal min-h-[36px]">{PROVIDER_DESC[p.id]}</p>
                    <div className="flex items-center justify-between pt-3 border-t border-zinc-800/60">
                      <span className="text-xs text-zinc-500 font-mono">{p.api_key ? "Key encrypted" : "No credentials"}</span>
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          onClick={() => {
                            setConfiguringProvider(p);
                            setApiKey("");
                            setBaseUrl(p.base_url || "");
                            setModelOverride(p.model_override || "");
                          }}
                        >
                          Configure
                        </Button>
                        {!p.is_active && (
                          <Button size="sm" variant="primary" disabled={!canActivate} onClick={() => handleActivateProvider(p.id)} title={canActivate ? `Activate ${p.id}` : "Configure credentials first"}>
                            Activate
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === "byok" && (
        <Card className="max-w-xl space-y-4 ui-fade-in">
          <div className="flex items-center gap-2">
            <Key size={16} className="text-zinc-200" />
            <h3 className="font-semibold text-zinc-100 text-sm uppercase tracking-wider">Bring Your Own Key (BYOK)</h3>
          </div>
          <p className="text-sm text-zinc-500 leading-relaxed">
            Specify a custom encryption key. Scanned logs and auditor comments are encrypted with this key in storage.
          </p>
          <form onSubmit={handleSaveByok} className="space-y-4">
            <Field label="Decryption secret key">
              <Input type="password" value={byokKey} onChange={(e) => setByokKey(e.target.value)} placeholder="Enter custom key" />
            </Field>
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">Key is cached locally in browser state.</span>
              <Button type="submit" variant="primary" icon={byokSaved ? Check : undefined}>{byokSaved ? "Key saved!" : "Save key"}</Button>
            </div>
          </form>
        </Card>
      )}

      <Modal
        open={!!configuringProvider}
        onClose={() => setConfiguringProvider(null)}
        title={configuringProvider ? `Configure ${configuringProvider.id.toUpperCase()}` : ""}
        description="Input parameters for the LLM provider."
      >
        {configuringProvider && (
          <form onSubmit={handleSaveProvider} className="space-y-4">
            <Field label="API key (optional — leave blank to use Application Default Credentials)">
              <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="AIza… (optional)" className="font-mono" />
            </Field>
            <Field label="Model override name">
              <Input value={modelOverride} onChange={(e) => setModelOverride(e.target.value)} placeholder="gemini-2.5-flash" className="font-mono" />
            </Field>
            <div className="flex items-center gap-2 text-xs text-zinc-400 bg-zinc-950 p-3 rounded-lg border border-zinc-800">
              <ShieldAlert size={14} className="shrink-0 text-zinc-500" />
              <span>Credentials are vault-encrypted using your environment BYOK key.</span>
            </div>
            <Button type="submit" variant="primary" loading={saving} className="w-full">
              {saving ? "Encrypting…" : "Save configuration"}
            </Button>
          </form>
        )}
      </Modal>
    </PageContainer>
  );
}
