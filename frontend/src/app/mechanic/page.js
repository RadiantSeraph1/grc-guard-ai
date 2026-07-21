"use client";

import { useEffect, useState, useCallback } from "react";
import { Wrench, Check, X, Clock } from "lucide-react";
import { useApi } from "../lib/api";
import { PageContainer, PageHeader, Card, Button, Badge, Skeleton, EmptyState } from "../components/ui";

const STATUS_TONE = { PROPOSED: "warning", APPLIED: "success", REJECTED: "danger" };

export default function MechanicPage() {
  const api = useApi();
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(null);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      setActions(await api.get("/api/mechanic/queue"));
    } catch {
      setActions([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const decide = async (id, action) => {
    setDeciding(id);
    try {
      await api.post(`/api/mechanic/${id}/${action}`);
      await fetchQueue();
    } catch (err) {
      alert(err.message || `Failed to ${action} this action.`);
    } finally {
      setDeciding(null);
    }
  };

  const pending = actions.filter((a) => a.status === "PROPOSED");
  const decided = actions.filter((a) => a.status !== "PROPOSED");

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Inspector-Mechanic Architecture"
        title="Mechanic Queue"
        description="Remediation actions proposed by the GRC Brain's Mechanic agent. Nothing here is applied automatically — every control/risk status change requires explicit Admin approval."
      />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : actions.length === 0 ? (
        <Card>
          <EmptyState icon={Wrench} title="No remediation proposals yet" description="Ask the GRC Brain to fix or remediate a specific control/risk and its Mechanic agent will propose a change here." />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="space-y-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Pending approval ({pending.length})</span>
            {pending.length === 0 && <p className="text-sm text-zinc-600">Nothing pending.</p>}
            {pending.map((a) => (
              <Card key={a.id} className="flex items-start justify-between gap-4">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="neutral">{a.target_type}</Badge>
                    <span className="font-mono text-xs text-zinc-500">{a.target_id}</span>
                    <span className="text-xs text-zinc-500">→ proposing</span>
                    <Badge variant="warning">{a.proposed_status}</Badge>
                  </div>
                  <p className="text-sm text-zinc-300">{a.rationale}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" variant="danger" icon={X} loading={deciding === a.id} onClick={() => decide(a.id, "reject")}>Reject</Button>
                  <Button size="sm" variant="primary" icon={Check} loading={deciding === a.id} onClick={() => decide(a.id, "approve")}>Approve</Button>
                </div>
              </Card>
            ))}
          </div>

          {decided.length > 0 && (
            <div className="space-y-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Decided</span>
              {decided.map((a) => (
                <Card key={a.id} className="flex items-start justify-between gap-4 opacity-70">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="neutral">{a.target_type}</Badge>
                      <span className="font-mono text-xs text-zinc-500">{a.target_id}</span>
                      <span className="text-xs text-zinc-500">→</span>
                      <Badge variant="neutral">{a.proposed_status}</Badge>
                    </div>
                    <p className="text-sm text-zinc-500">{a.rationale}</p>
                  </div>
                  <Badge variant={STATUS_TONE[a.status] || "neutral"}>
                    <Clock size={11} className="mr-1 inline" />{a.status}
                  </Badge>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}
