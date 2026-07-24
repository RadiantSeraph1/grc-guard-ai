"use client";

import { useState, useEffect, useCallback } from "react";
import { Download, MessageSquare, Send, HelpCircle, ArrowDownToLine, Clock, User } from "lucide-react";
import { useApi } from "../lib/api";
import {
  PageContainer, PageHeader, Card, Badge, Button, Skeleton, EmptyState, Input, cn, toast,
} from "../components/ui";

const VIEW_MODES = [
  { key: "FULL", label: "Full Ledger" },
  { key: "CONTROLLED", label: "Approved Only" },
  { key: "IRL", label: "IRL View Mode" },
];

export default function AuditPage() {
  const api = useApi();
  const [controls, setControls] = useState([]);
  const [comments, setComments] = useState({});
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("FULL");
  const [activeControl, setActiveControl] = useState(null);
  const [newComment, setNewComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchComments = useCallback(async (ctrlId) => {
    try {
      const data = await api.get(`/api/audit/comments?control_id=${ctrlId}`);
      setComments((prev) => ({ ...prev, [ctrlId]: Array.isArray(data) ? data : [] }));
    } catch {
      setComments((prev) => ({ ...prev, [ctrlId]: [] }));
    }
  }, [api]);

  const fetchData = useCallback(async () => {
    try {
      const raw = await api.get("/api/controls");
      const ctrlData = Array.isArray(raw) ? raw : [];
      setControls(ctrlData);
      if (ctrlData.length > 0) {
        setActiveControl(ctrlData[0]);
        fetchComments(ctrlData[0].id);
      }
    } catch {
      setControls([]);
    } finally {
      setLoading(false);
    }
  }, [api, fetchComments]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSendComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim() || !activeControl) return;
    setSubmitting(true);
    try {
      await api.post("/api/audit/comments", { control_id: activeControl.id, comment_text: newComment });
      setNewComment("");
      await fetchComments(activeControl.id);
    } catch (err) {
      toast.error(`Could not post comment: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadBundle = async () => {
    try {
      const data = await api.get("/api/audit/bundle");
      toast.success(`Audit bundle generated: ${data.bundle_id}.`);
    } catch {
      toast.error("Failed to generate bundle. Backend is offline.");
    }
  };

  const selectControl = (c) => {
    setActiveControl(c);
    fetchComments(c.id);
  };

  const thread = activeControl ? comments[activeControl.id] : null;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Compliance Assurance"
        title="Auditor Portal"
        description="Give external assessors scoped access, evidence downloads, and per-control comment threads."
        actions={<Button variant="primary" icon={Download} onClick={handleDownloadBundle}>Evidence bundle</Button>}
      />

      <Card className="flex flex-col sm:flex-row gap-4 justify-between items-center">
        <span className="text-xs text-zinc-500 font-semibold uppercase tracking-wide">Auditor view limits</span>
        <div className="flex gap-2">
          {VIEW_MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setViewMode(m.key)}
              className={cn(
                "py-1.5 px-3.5 text-xs font-semibold rounded-lg cursor-pointer transition-colors border",
                viewMode === m.key ? "bg-zinc-800 text-zinc-100 border-zinc-700" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Controls list */}
        <Card className="p-0 overflow-hidden h-fit">
          <div className="p-4 border-b border-zinc-800/60 bg-zinc-900/30">
            <h3 className="text-sm font-semibold text-zinc-100">Monitored Controls</h3>
          </div>
          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : controls.length === 0 ? (
            <EmptyState icon={HelpCircle} title="No controls defined" description="Define controls to begin an audit." />
          ) : (
            <div className="divide-y divide-zinc-800/60 max-h-[480px] overflow-y-auto custom-scrollbar">
              {controls.map((c) => (
                <button
                  key={c.id}
                  onClick={() => selectControl(c)}
                  className={cn(
                    "w-full text-left p-4 cursor-pointer transition-colors flex items-center justify-between gap-2",
                    activeControl?.id === c.id ? "bg-zinc-800/30 border-l-2 border-l-indigo-400" : "hover:bg-zinc-900/30 border-l-2 border-l-transparent"
                  )}
                >
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-medium text-zinc-200">{c.control_code}</div>
                    <div className="truncate text-xs text-zinc-400 max-w-[170px]">{c.title}</div>
                  </div>
                  <Badge variant={c.status === "Passing" ? "success" : "danger"}>{c.status}</Badge>
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* Thread */}
        {activeControl ? (
          <Card className="lg:col-span-2 flex flex-col gap-5">
            <div className="border-b border-zinc-800/60 pb-4 flex justify-between items-start gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-zinc-100">[{activeControl.control_code}] {activeControl.title}</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Collaborative audit thread for compliance checks.</p>
              </div>
              <Button size="sm" icon={ArrowDownToLine} onClick={() => toast.info(`Fetching evidence for ${activeControl.control_code}…`)}>
                Evidence
              </Button>
            </div>

            <div className="flex-1 min-h-[200px] max-h-[320px] overflow-y-auto space-y-3 pr-1 custom-scrollbar">
              {!thread || thread.length === 0 ? (
                <EmptyState icon={MessageSquare} title="No auditor comments yet" description="Start the thread for this control below." />
              ) : (
                thread.map((comm) => (
                  <div key={comm.id} className="flex flex-col gap-1 bg-zinc-900/40 p-3.5 rounded-xl border border-zinc-800">
                    <div className="flex items-center justify-between text-xs text-zinc-500">
                      <span className="font-semibold text-zinc-300 flex items-center gap-1"><User size={11} className="text-zinc-400" />{comm.sender_name}</span>
                      <span className="flex items-center gap-1">
                        <Clock size={11} />
                        {new Date(comm.timestamp * 1000).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}
                      </span>
                    </div>
                    <p className="text-zinc-200 leading-relaxed text-sm">{comm.comment_text}</p>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleSendComment} className="flex items-center gap-2 pt-4 border-t border-zinc-800/60">
              <Input
                required
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Submit audit clarification or link evidence snapshot…"
                className="flex-1"
              />
              <Button type="submit" variant="primary" loading={submitting} disabled={!newComment.trim()} className="!px-2.5">
                <Send size={15} />
              </Button>
            </form>
          </Card>
        ) : (
          <Card className="lg:col-span-2">
            <EmptyState icon={HelpCircle} title="No control selected" description="Pick a control from the list to view its thread." />
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
