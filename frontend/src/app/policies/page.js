"use client";

import { useState, useEffect, useCallback } from "react";
import { FileText, Upload, Users, Plus, ShieldAlert, Award, ClipboardCheck } from "lucide-react";
import { useApi } from "../lib/api";
import {
  PageContainer, PageHeader, Card, Badge, Button, Skeleton, EmptyState,
  Modal, Field, Input, ProgressBar, statusVariant, toast,
} from "../components/ui";

export default function PoliciesPage() {
  const api = useApi();
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newFile, setNewFile] = useState(null);
  const [regulatoryVersion, setRegulatoryVersion] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const fetchPolicies = useCallback(async () => {
    try {
      const data = await api.get("/api/policies");
      setPolicies(Array.isArray(data) ? data : []);
    } catch {
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const resetForm = () => {
    setUploadOpen(false);
    setNewTitle("");
    setNewFile(null);
    setRegulatoryVersion("");
    setEffectiveDate("");
    setExpirationDate("");
  };

  const handleUploadPolicy = async (e) => {
    e.preventDefault();
    if (!newTitle.trim() || !newFile) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("title", newTitle);
    formData.append("file", newFile);
    if (regulatoryVersion.trim()) formData.append("regulatory_version", regulatoryVersion.trim());
    if (effectiveDate) formData.append("effective_date", effectiveDate);
    if (expirationDate) formData.append("expiration_date", expirationDate);
    try {
      await api.post("/api/policies/upload", formData);
      resetForm();
      await fetchPolicies();
    } catch (err) {
      toast.error(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleApprovePolicy = async (id) => {
    setBusyId(id);
    try {
      await api.post(`/api/policies/${id}/approve`);
      await fetchPolicies();
    } catch (err) {
      toast.error(`Approve failed: ${err.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleAcknowledgePolicy = async (id) => {
    setBusyId(id);
    try {
      await api.post(`/api/policies/${id}/acknowledge`);
      await fetchPolicies();
    } catch (err) {
      toast.error(`Acknowledge failed: ${err.message}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Compliance Governance"
        title="Policies Manager"
        description="Author security frameworks, coordinate approvals, and track employee digital sign-offs."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setUploadOpen(true)}>Upload policy</Button>
        }
      />

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
        </div>
      ) : policies.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="No policies uploaded"
            description="Upload regulatory policy manuals — they're indexed by RAG for compliance scanning."
            action={<Button variant="primary" size="sm" icon={Plus} onClick={() => setUploadOpen(true)}>Upload policy</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {policies.map((p) => {
            const ackPercent = p.total_employees > 0 ? Math.round((p.acknowledgments / p.total_employees) * 100) : 0;
            return (
              <Card key={p.id} hover className="flex flex-col justify-between gap-5">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-zinc-900 flex items-center justify-center border border-zinc-800 shrink-0">
                        <FileText size={16} className="text-zinc-400" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-semibold text-zinc-200 leading-snug line-clamp-1">{p.title}</h4>
                        <span className="text-xs text-zinc-500 uppercase">Version {p.version}</span>
                      </div>
                    </div>
                    <Badge variant={statusVariant(p.status)}>{p.status}</Badge>
                  </div>

                  {p.status === "Approved" && (
                    <div className="space-y-1.5 bg-[#09090b] p-3 rounded-lg border border-zinc-800">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 font-semibold uppercase tracking-wide flex items-center gap-1">
                          <Users size={11} /> Sign-offs
                        </span>
                        <span className="font-semibold text-zinc-300">{p.acknowledgments} / {p.total_employees} ({ackPercent}%)</span>
                      </div>
                      <ProgressBar value={ackPercent} tone="neutral" />
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-zinc-800/60">
                  {p.status !== "Approved" ? (
                    <Button icon={ClipboardCheck} loading={busyId === p.id} onClick={() => handleApprovePolicy(p.id)} className="w-full">
                      Approve &amp; publish
                    </Button>
                  ) : (
                    <Button variant="primary" icon={Award} loading={busyId === p.id} onClick={() => handleAcknowledgePolicy(p.id)} className="w-full">
                      Digitally acknowledge
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={uploadOpen} onClose={resetForm} title="Author GRC Policy" description="Upload regulatory policy manuals to the local index.">
        <form onSubmit={handleUploadPolicy} className="space-y-4">
          <Field label="Policy title">
            <Input required value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g. Encryption Key Management Policy" />
          </Field>
          <Field label="PDF / text manual">
            <div className="flex flex-col items-center justify-center w-full bg-[#09090b] border border-dashed border-zinc-800 hover:border-zinc-700 rounded-lg p-4 cursor-pointer text-zinc-500 hover:text-zinc-300 transition-colors relative">
              <Upload size={20} className="mb-1 text-zinc-400" />
              <span className="text-xs text-center font-medium">{newFile ? newFile.name : "Click to select local file"}</span>
              <input type="file" required onChange={(e) => setNewFile(e.target.files[0])} className="absolute inset-0 opacity-0 cursor-pointer" />
            </div>
          </Field>
          <Field label="Regulatory version (optional)">
            <Input value={regulatoryVersion} onChange={(e) => setRegulatoryVersion(e.target.value)} placeholder="e.g. Basel III 2019 revision" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Effective date (optional)">
              <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
            </Field>
            <Field label="Expiration date (optional)">
              <Input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} />
            </Field>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-400 bg-zinc-900/50 p-3 rounded-lg border border-zinc-800">
            <ShieldAlert size={14} className="shrink-0 text-zinc-500" />
            <span>Uploaded items are indexed by RAG (with automatic PII redaction) for compliance scanning. An expiration date excludes this document from future scans automatically.</span>
          </div>
          <Button type="submit" variant="primary" loading={uploading} disabled={!newFile} className="w-full">
            {uploading ? "Analyzing & indexing…" : "Publish draft policy"}
          </Button>
        </form>
      </Modal>
    </PageContainer>
  );
}
