"use client";

import { useEffect, useState, useCallback } from "react";
import { ShieldCheck, ShieldAlert, RotateCw, Fingerprint, Cpu, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useApi } from "../lib/api";
import { PageContainer, PageHeader, Card, Button, Badge, Skeleton, EmptyState, cn } from "../components/ui";

export default function AttestationPage() {
  const api = useApi();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await api.get("/api/security/attestation-status"));
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const attested = !!report?.attested;
  const violations = report?.policy_violations || [];
  const warnings = report?.policy_warnings || [];

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Policy-Compliant API"
        title="Attestation & Policy Status"
        description="Verifies the active LLM provider against internal security policy — encryption in transit, zero data retention, pinned model version, approved region — via workload attestation before compliance data is sent. Per EU AI Act Art. 9 (Risk Management) + Art. 13 (Transparency)."
        actions={<Button icon={RotateCw} loading={loading} onClick={fetchStatus}>Re-check</Button>}
      />

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : !report || report.provider === "none" ? (
        <Card>
          <EmptyState
            icon={ShieldAlert}
            title="No active AI provider to attest"
            description={report?.error || "Configure and activate an AI provider in Settings → AI Gateway, then re-check."}
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatusTile
              label="Attestation"
              value={attested ? "Attested" : "Failed"}
              icon={attested ? ShieldCheck : ShieldAlert}
              tone={attested ? "success" : "danger"}
              footer={report.attestation_level ? `Level: ${report.attestation_level}` : undefined}
            />
            <StatusTile label="Provider" value={report.provider} icon={Cpu} footer={report.model || undefined} />
            <StatusTile
              label="Quote Verified"
              value={report.quote_verified ? "Yes" : "No"}
              icon={Fingerprint}
              tone={report.quote_verified ? "success" : "danger"}
              footer={report.quote_method === "gcp_signed_identity_token" ? "Google-signed identity token" : "TPM2_QUOTE (software-simulated)"}
            />
            <StatusTile
              label="Policy"
              value={report.policy_passed ? "Passed" : "Violations"}
              icon={report.policy_passed ? CheckCircle2 : XCircle}
              tone={report.policy_passed ? "success" : "danger"}
              footer={`${violations.length} violation(s), ${warnings.length} warning(s)`}
            />
          </div>

          <Card className="space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <span className="text-sm font-semibold text-zinc-100">Quote Evidence</span>
              <Badge variant="neutral">{report.eu_ai_act_article}</Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <DetailField label="PCR Digest" value={report.pcr_digest} mono />
              <DetailField label="Quote Signature" value={report.quote_signature} mono />
              <DetailField label="Nonce" value={report.nonce} mono />
              <DetailField label="Attested At" value={report.timestamp_human} />
              {report.workload_identity && (
                <>
                  <DetailField label="GCP Service Account" value={report.workload_identity.service_account} mono />
                  <DetailField label="GCE Instance" value={report.workload_identity.instance} mono />
                  <DetailField label="GCP Project" value={report.workload_identity.project_id} mono />
                  <DetailField label="Token Issuer" value={report.workload_identity.issuer} mono />
                </>
              )}
            </div>
          </Card>

          {(violations.length > 0 || warnings.length > 0) && (
            <Card className="space-y-3">
              <span className="text-sm font-semibold text-zinc-100">Policy Findings</span>
              {violations.map((v, i) => (
                <div key={`v-${i}`} className="flex items-start gap-2 text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
                  <XCircle size={14} className="shrink-0 mt-0.5" />
                  <span>{v}</span>
                </div>
              ))}
              {warnings.map((w, i) => (
                <div key={`w-${i}`} className="flex items-start gap-2 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </PageContainer>
  );
}

function DetailField({ label, value, mono }) {
  return (
    <div>
      <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide block mb-1">{label}</span>
      <p className={cn("text-zinc-300 break-all", mono && "font-mono text-xs")}>{value || "—"}</p>
    </div>
  );
}

const TONE_RING = {
  zinc: "text-zinc-400 bg-zinc-800/40 border-zinc-700/40",
  danger: "text-rose-400 bg-rose-500/10 border-rose-500/20",
  success: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
};

// Free-text status tile (e.g. "Attested", "groq") — StatCard's AnimatedCounter
// coerces non-numeric values to 0 via parseInt, so it can't be reused here.
function StatusTile({ label, value, icon: Icon, tone = "zinc", footer }) {
  return (
    <Card hover className="flex items-start justify-between">
      <div className="space-y-2 min-w-0">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
        <div className="text-2xl font-semibold tracking-tight text-zinc-50 truncate">{value}</div>
        {footer && <span className="block text-xs text-zinc-500">{footer}</span>}
      </div>
      {Icon && (
        <div className={cn("w-10 h-10 rounded-lg border flex items-center justify-center shrink-0", TONE_RING[tone])}>
          <Icon size={18} />
        </div>
      )}
    </Card>
  );
}
