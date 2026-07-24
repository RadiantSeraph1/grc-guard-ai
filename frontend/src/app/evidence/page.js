"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  FileCode, Upload, Link2, ShieldAlert, PlusCircle, ArrowDownToLine, Library,
} from "lucide-react";
import { useApi } from "../lib/api";
import {
  PageContainer, PageHeader, Card, Badge, Button, Skeleton, EmptyState,
  Modal, Field, Input, Select, SearchInput, statusVariant, toast,
} from "../components/ui";

export default function EvidencePage() {
  const api = useApi();
  const [evidence, setEvidence] = useState([]);
  const [controls, setControls] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [controlId, setControlId] = useState("");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [ctrlData, evData] = await api.getMany(["/api/controls", "/api/evidence"], []);
      setControls(Array.isArray(ctrlData) ? ctrlData : []);
      setEvidence(Array.isArray(evData) ? evData : []);
    } catch {
      setEvidence([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const resetForm = () => {
    setUploadOpen(false);
    setTitle("");
    setControlId("");
    setFile(null);
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!title.trim() || !controlId || !file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("title", title);
    formData.append("control_id", controlId);
    formData.append("file", file);
    try {
      await api.post("/api/evidence/upload", formData);
      await fetchData();
      resetForm();
    } catch (err) {
      toast.error(`Upload failed: ${err.message}. Ensure you have an Admin/Editor role.`);
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (item) => {
    try {
      const response = await api.raw("GET", `/api/evidence/${item.id}/download`);
      if (!response.ok) {
        toast.error("Could not download this evidence file.");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error("Could not download this evidence file.");
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return evidence.filter(
      (e) => e.title?.toLowerCase().includes(q) || e.control_code?.toLowerCase().includes(q)
    );
  }, [evidence, search]);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Audit Logs Ledger"
        title="Evidence Library"
        description="Review automatically collected integration logs, snapshots, and manually uploaded compliance records."
        actions={
          <Button variant="primary" icon={PlusCircle} onClick={() => setUploadOpen(true)}>
            Upload evidence
          </Button>
        }
      />

      <Card>
        <SearchInput
          className="max-w-md"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search evidence title or control mapping…"
        />
      </Card>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={Library}
            title={evidence.length === 0 ? "No evidence collected yet" : "No evidence matches your search"}
            description={evidence.length === 0 ? "Upload records or connect integrations to populate the ledger." : "Try a different search term."}
            action={evidence.length === 0 ? <Button variant="primary" size="sm" icon={PlusCircle} onClick={() => setUploadOpen(true)}>Upload evidence</Button> : null}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((item) => (
            <Card key={item.id} hover className="flex flex-col justify-between gap-5">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center border border-zinc-800 shrink-0">
                    <FileCode size={18} className="text-zinc-400" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-zinc-200 leading-snug line-clamp-1">{item.title}</h4>
                    <span className="text-xs text-zinc-500 font-mono">{item.file_name} {item.file_size ? `(${item.file_size})` : ""}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="flex items-center gap-1 text-zinc-400 bg-[#09090b] px-2 py-1 rounded border border-zinc-800">
                    <Link2 size={11} className="text-zinc-500" />
                    {item.control_code}
                  </span>
                  <Badge variant={statusVariant(item.freshness)}>{item.freshness}</Badge>
                </div>
              </div>
              <div className="pt-4 border-t border-zinc-800/60 flex justify-between items-center text-xs text-zinc-500">
                <span>Uploaded: {item.upload_date}</span>
                <button
                  onClick={() => handleDownload(item)}
                  className="text-zinc-400 hover:text-zinc-100 font-medium flex items-center gap-1 cursor-pointer"
                >
                  <ArrowDownToLine size={13} />
                  Download
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={uploadOpen} onClose={resetForm} title="Log Compliance Evidence" description="Verify control requirements with evidence logs.">
        <form onSubmit={handleUpload} className="space-y-4">
          <Field label="Evidence description">
            <Input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. S3 Bucket Public Access Block Config"
            />
          </Field>
          <Field label="Target control mapping">
            <Select required value={controlId} onChange={(e) => setControlId(e.target.value)}>
              <option value="">— Choose control —</option>
              {controls.map((c) => (
                <option key={c.id} value={c.id}>[{c.control_code}] {c.title}</option>
              ))}
            </Select>
          </Field>
          <Field label="Upload file / log export">
            <div className="flex flex-col items-center justify-center w-full bg-[#09090b] border border-dashed border-zinc-800 hover:border-zinc-700 rounded-lg p-4 cursor-pointer text-zinc-500 hover:text-zinc-300 transition-colors relative">
              <Upload size={20} className="mb-1 text-zinc-400" />
              <span className="text-xs text-center font-medium">{file ? file.name : "Click to select local file"}</span>
              <input
                type="file"
                required
                onChange={(e) => setFile(e.target.files[0])}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
            </div>
          </Field>
          <div className="flex items-center gap-2 text-xs text-zinc-400 bg-zinc-900/50 p-3 rounded-lg border border-zinc-800">
            <ShieldAlert size={14} className="shrink-0 text-zinc-500" />
            <span>Uploaded items are logged to the persistent ledger.</span>
          </div>
          <Button type="submit" variant="primary" loading={uploading} disabled={!file || !controlId} className="w-full">
            {uploading ? "Verifying file…" : "Commit evidence"}
          </Button>
        </form>
      </Modal>
    </PageContainer>
  );
}
