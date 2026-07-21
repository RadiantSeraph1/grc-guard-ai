"use client";

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import {
  ShieldCheck, AlertTriangle, AlertOctagon, RotateCw, User, Clock,
  ShieldAlert, ChevronDown, ChevronUp,
} from "lucide-react";
import { useApi } from "../lib/api";
import {
  PageContainer, PageHeader, Card, Badge, Button, Skeleton, EmptyState,
  SearchInput, Select, cn,
} from "../components/ui";

const STATUS_ICON = {
  Passing: <ShieldCheck className="text-emerald-400" size={15} />,
  Warning: <AlertTriangle className="text-amber-400" size={15} />,
  Failing: <AlertOctagon className="text-rose-400" size={15} />,
};
const STATUS_VARIANT = { Passing: "success", Warning: "warning", Failing: "danger" };

function StatTile({ label, value, accent }) {
  const border = {
    emerald: "border-l-emerald-500",
    amber: "border-l-amber-500",
    rose: "border-l-rose-500",
    zinc: "border-l-zinc-600",
  }[accent];
  const text = { emerald: "text-emerald-400", amber: "text-amber-400", rose: "text-rose-400", zinc: "text-zinc-100" }[accent];
  return (
    <Card className={cn("border-l-2", border)}>
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      <h4 className={cn("text-2xl font-semibold mt-1 tabular-nums", text)}>{value}</h4>
    </Card>
  );
}

export default function ControlsPage() {
  const api = useApi();
  const [controls, setControls] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [frameworkFilter, setFrameworkFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const fetchControls = useCallback(async () => {
    try {
      const data = await api.get("/api/controls");
      setControls(Array.isArray(data) ? data : []);
    } catch {
      setControls([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchControls();
  }, [fetchControls]);

  const handleTestControl = async (id) => {
    setTestingId(id);
    try {
      await api.post(`/api/controls/${id}/test`);
      await fetchControls();
    } catch (err) {
      console.error("Control test failed", err);
    } finally {
      setTestingId(null);
    }
  };

  const filtered = useMemo(() => {
    let result = controls;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.title?.toLowerCase().includes(q) ||
          c.control_code?.toLowerCase().includes(q) ||
          c.description?.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "ALL") result = result.filter((c) => c.status === statusFilter);
    if (frameworkFilter !== "ALL") result = result.filter((c) => c.frameworks?.includes(frameworkFilter));
    return result;
  }, [controls, search, statusFilter, frameworkFilter]);

  const total = controls.length;
  const passing = controls.filter((c) => c.status === "Passing").length;
  const warning = controls.filter((c) => c.status === "Warning").length;
  const failing = controls.filter((c) => c.status === "Failing").length;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Compliance Auditing"
        title="Controls Monitor"
        description="Monitor governance controls, run automated validations, and track framework mappings."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-5">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
        ) : (
          <>
            <StatTile label="Total Controls" value={total} accent="zinc" />
            <StatTile label="Passing" value={passing} accent="emerald" />
            <StatTile label="Warning" value={warning} accent="amber" />
            <StatTile label="Failing" value={failing} accent="rose" />
          </>
        )}
      </div>

      <Card className="flex flex-col lg:flex-row gap-3 justify-between">
        <SearchInput
          className="flex-1 lg:max-w-md"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search control name, description, code…"
        />
        <div className="flex flex-col sm:flex-row gap-3">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="sm:w-40">
            <option value="ALL">All statuses</option>
            <option value="Passing">Passing</option>
            <option value="Warning">Warning</option>
            <option value="Failing">Failing</option>
          </Select>
          <Select value={frameworkFilter} onChange={(e) => setFrameworkFilter(e.target.value)} className="sm:w-44">
            <option value="ALL">All frameworks</option>
            <option value="basel-iii">Basel III</option>
            <option value="soc-2">SOC 2</option>
            <option value="iso-27001">ISO 27001</option>
            <option value="nist-csf">NIST CSF</option>
            <option value="pci-dss">PCI DSS</option>
            <option value="gdpr">GDPR</option>
          </Select>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title={controls.length === 0 ? "No controls defined" : "No controls match your filters"}
            description={controls.length === 0 ? "Import a framework or create controls to begin monitoring." : "Adjust the search or filters above."}
          />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full min-w-[900px] text-left text-sm border-collapse">
              <thead>
                <tr className="bg-zinc-900/40 border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                  <th className="py-3.5 px-5 w-10" />
                  <th className="py-3.5 px-5 w-36 font-semibold">Code</th>
                  <th className="py-3.5 px-5 font-semibold">Title</th>
                  <th className="py-3.5 px-5 w-48 font-semibold">Frameworks</th>
                  <th className="py-3.5 px-5 w-32 font-semibold">Status</th>
                  <th className="py-3.5 px-5 w-32 font-semibold">Last Tested</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const isExpanded = expandedId === c.id;
                  return (
                    <Fragment key={c.id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : c.id)}
                        className="border-b border-zinc-800/50 hover:bg-zinc-900/30 cursor-pointer transition-colors"
                      >
                        <td className="py-3.5 px-5 text-zinc-500">
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </td>
                        <td className="py-3.5 px-5 font-mono font-medium text-zinc-200">{c.control_code}</td>
                        <td className="py-3.5 px-5 font-medium text-zinc-300">{c.title}</td>
                        <td className="py-3.5 px-5">
                          <div className="flex flex-wrap gap-1.5">
                            {(c.frameworks || "").split(",").filter(Boolean).map((f) => (
                              <span key={f} className="text-xs bg-zinc-900 border border-zinc-800 text-zinc-400 font-medium py-0.5 px-2 rounded uppercase">
                                {f}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3.5 px-5">
                          <Badge variant={STATUS_VARIANT[c.status] || "neutral"}>
                            {STATUS_ICON[c.status]}
                            {c.status}
                          </Badge>
                        </td>
                        <td className="py-3.5 px-5 text-zinc-500">
                          {c.last_tested ? new Date(c.last_tested * 1000).toLocaleDateString() : "Never"}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-zinc-900/20 border-b border-zinc-800/40">
                          <td colSpan={6} className="p-5">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 text-sm">
                              <div className="lg:col-span-2 space-y-4">
                                <div>
                                  <h5 className="font-semibold text-zinc-500 uppercase tracking-wider text-xs mb-1.5">Description</h5>
                                  <p className="text-zinc-300 leading-relaxed">{c.description || "No description provided."}</p>
                                </div>
                                <div className="p-4 rounded-xl bg-[#09090b] border border-zinc-800 flex items-start gap-3">
                                  <ShieldAlert size={16} className="text-zinc-400 mt-0.5 shrink-0" />
                                  <div className="space-y-1">
                                    <h6 className="font-semibold text-zinc-200">Verification</h6>
                                    <p className="text-zinc-400 leading-relaxed text-xs">
                                      Re-checking pulls live evidence from mapped connectors and re-evaluates this
                                      control against its current data sources.
                                    </p>
                                  </div>
                                </div>
                              </div>

                              <div className="space-y-3.5 bg-zinc-900/20 p-4 rounded-xl border border-zinc-800/60">
                                <div className="flex items-center gap-2 text-zinc-400">
                                  <User size={14} />
                                  <span className="font-medium">Owner:</span>
                                  <span className="text-zinc-200 font-medium">{c.owner_name || c.owner_id || "Unassigned"}</span>
                                </div>
                                <div className="flex items-center gap-2 text-zinc-400">
                                  <Clock size={14} />
                                  <span className="font-medium">Last checked:</span>
                                  <span className="text-zinc-200">{c.last_tested ? new Date(c.last_tested * 1000).toLocaleString() : "Never"}</span>
                                </div>
                                <Button
                                  variant="primary"
                                  icon={RotateCw}
                                  loading={testingId === c.id}
                                  onClick={() => handleTestControl(c.id)}
                                  className="w-full"
                                >
                                  {testingId === c.id ? "Testing…" : "Trigger audit recheck"}
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageContainer>
  );
}
