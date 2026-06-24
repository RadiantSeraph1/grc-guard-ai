"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { Search, UserPlus, Trash2, Shield, Building, Users } from "lucide-react";
import { useApi } from "../lib/api";
import {
  PageContainer, PageHeader, Card, CardHeader, Badge, Button, Skeleton, EmptyState,
  Modal, Field, Input, Select, SearchInput, cn,
} from "../components/ui";

export default function ProfilePage() {
  const { userId } = useAuth();
  const { user: clerkUser } = useUser();
  const api = useApi();

  const [activeSubTab, setActiveSubTab] = useState("profile");
  const [people, setPeople] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [company, setCompany] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [me, setMe] = useState(null);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("Employee");
  const [newDept, setNewDept] = useState("General");
  const [newTraining, setNewTraining] = useState(false);
  const [newBackground, setNewBackground] = useState(false);

  const fetchPeople = useCallback(async () => {
    try {
      const [data, session, departmentData, stats] = await api.getMany(
        ["/api/people", "/api/auth/session", "/api/departments", "/api/dashboard/stats"],
        null
      );
      const peopleList = Array.isArray(data) ? data : [];
      const fallbackUser = {
        id: userId,
        name: clerkUser?.fullName || "Active User",
        email: clerkUser?.primaryEmailAddress?.emailAddress || "",
        role: "Employee",
        department: "General",
        status: "Active",
        training_completed: false,
        background_check_passed: false,
      };
      setPeople(peopleList);
      setDepartments(Array.isArray(departmentData) ? departmentData : []);
      setCompany(stats?.company || "");
      setMe(session || peopleList.find((p) => p.id === userId) || fallbackUser);
    } catch (err) {
      console.error("Failed to load people database:", err);
    } finally {
      setLoading(false);
    }
  }, [api, userId, clerkUser]);

  useEffect(() => {
    fetchPeople();
  }, [fetchPeople]);

  const handleAddUser = async (e) => {
    e.preventDefault();
    if (!newName || !newEmail) return;
    setSubmitting(true);
    try {
      await api.post("/api/people", {
        name: newName, email: newEmail, role: newRole, department: newDept,
        training_completed: newTraining, background_check_passed: newBackground, status: "Active",
      });
      setIsAddOpen(false);
      setNewName(""); setNewEmail(""); setNewRole("Employee"); setNewDept("General");
      setNewTraining(false); setNewBackground(false);
      await fetchPeople();
    } catch (err) {
      alert(err.message || "Failed to create user.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteUser = async (id) => {
    if (id === userId) {
      alert("You cannot delete your own active session account.");
      return;
    }
    if (!confirm("Remove this user from the organization?")) return;
    try {
      await api.del(`/api/people/${id}`);
      await fetchPeople();
    } catch (err) {
      alert(`Failed to remove user: ${err.message}`);
    }
  };

  const handleToggleField = async (person, field) => {
    try {
      await api.put(`/api/people/${person.id}`, { [field]: !person[field] });
      await fetchPeople();
    } catch (err) {
      console.error(err);
    }
  };

  const isAdmin = ["Admin", "SuperAdmin"].includes(me?.role);
  const profileName = me?.name || clerkUser?.fullName || "Active User";
  const profileRole = me?.role || "Employee";
  const departmentOptions = departments.length
    ? departments.map((d) => d.name)
    : Array.from(new Set(people.map((p) => p.department || "General")));

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return people.filter(
      (p) => (p.name || "").toLowerCase().includes(q) || (p.email || "").toLowerCase().includes(q) || (p.department || "").toLowerCase().includes(q)
    );
  }, [people, search]);

  return (
    <PageContainer>
      <PageHeader eyebrow="Enterprise Directory" title="Profile & Team Management" description="View your secure profile credentials and manage department users." />

      <div className="flex border-b border-zinc-800 gap-6 text-xs">
        {[["profile", "My Profile"], ["database", "Database Registry"]].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveSubTab(id)}
            className={cn(
              "pb-2.5 font-medium border-b-2 transition-colors cursor-pointer",
              activeSubTab === id ? "border-indigo-400 text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-300"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {activeSubTab === "profile" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start ui-fade-in">
          <Card className="space-y-4">
            <div className="flex items-center gap-3.5 pb-4 border-b border-zinc-800/60">
              <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center font-semibold text-zinc-100 text-lg border border-zinc-700 shrink-0">
                {profileName.substring(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-zinc-200 text-sm truncate">{profileName}</h3>
                <span className="block text-xs text-zinc-500 font-mono truncate">{me?.id || userId}</span>
              </div>
            </div>
            <dl className="space-y-3 text-sm">
              <Row label="Email"><span className="break-all">{me?.email || clerkUser?.primaryEmailAddress?.emailAddress || "Not available"}</span></Row>
              <Row label="Department">{me?.department || "General"}</Row>
              <Row label="System Role"><span className="flex items-center gap-1"><Shield size={12} className="text-zinc-400" />{profileRole}</span></Row>
              <Row label="Account Status">{me?.status || "Active"}</Row>
              <Row label="Training Check"><Badge variant={me?.training_completed ? "success" : "warning"}>{me?.training_completed ? "Passed" : "Pending"}</Badge></Row>
              <Row label="Background Check"><Badge variant={me?.background_check_passed ? "success" : "danger"}>{me?.background_check_passed ? "Verified" : "Missing"}</Badge></Row>
            </dl>
          </Card>

          <Card className="lg:col-span-2 space-y-4">
            <div className="flex items-center gap-2 text-zinc-200">
              <Building size={16} className="text-zinc-400" />
              <h3 className="font-semibold text-sm uppercase tracking-wider">Company Scope</h3>
            </div>
            <dl className="space-y-3 text-sm">
              <Row label="Company">{company || "Your organization"}</Row>
              <Row label="Operating Model"><span className="text-emerald-400 font-semibold">Active & Audited</span></Row>
            </dl>
          </Card>
        </div>
      )}

      {activeSubTab === "database" && (
        <div className="space-y-5 ui-fade-in">
          {departments.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {departments.map((d) => (
                <Card key={d.id || d.name} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-widest text-zinc-500 font-semibold">Department</p>
                      <h4 className="mt-1 text-sm font-semibold text-zinc-100 truncate">{d.name}</h4>
                    </div>
                    <Badge variant="success">{d.status || "Active"}</Badge>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-zinc-500 line-clamp-2">{d.description || "No department description recorded."}</p>
                  <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                    <span>{d.users_count || 0} users</span>
                    <span>{d.controls_count || 0} controls</span>
                    <span>{d.risks_count || 0} risks</span>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <Card className="space-y-5">
            <CardHeader
              title="Compliance registry directory"
              description="Manage permissions, onboarding, and auditing parameters for all department users."
              action={isAdmin ? <Button variant="primary" size="sm" icon={UserPlus} onClick={() => setIsAddOpen(true)}>Add member</Button> : null}
            />
            <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, department…" />

            <div className="border border-zinc-800 rounded-lg overflow-x-auto">
              {loading ? (
                <div className="p-5 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : filtered.length === 0 ? (
                <EmptyState icon={Users} title="No team members found" description="Add members or adjust your search." />
              ) : (
                <table className="w-full min-w-[760px] text-left text-sm border-collapse">
                  <thead>
                    <tr className="bg-zinc-900/40 border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                      <th className="py-3 px-4 font-semibold">Name</th>
                      <th className="py-3 px-4 font-semibold">Department</th>
                      <th className="py-3 px-4 font-semibold">Role</th>
                      <th className="py-3 px-4 text-center font-semibold">Background</th>
                      <th className="py-3 px-4 text-center font-semibold">Training</th>
                      {isAdmin && <th className="py-3 px-4 text-center w-20 font-semibold">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => (
                      <tr key={item.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/30 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-medium text-zinc-200">{item.name || "Unnamed User"}</div>
                          <div className="text-xs text-zinc-500 font-mono">{item.email || "No email"}</div>
                        </td>
                        <td className="py-3 px-4 text-zinc-400">{item.department || "General"}</td>
                        <td className="py-3 px-4 text-zinc-400 font-medium">{item.role || "Employee"}</td>
                        <td className="py-3 px-4 text-center">
                          <button
                            disabled={!isAdmin}
                            onClick={() => isAdmin && handleToggleField(item, "background_check_passed")}
                            className={cn("cursor-pointer disabled:cursor-default", !isAdmin && "pointer-events-none")}
                          >
                            <Badge variant={item.background_check_passed ? "success" : "danger"}>{item.background_check_passed ? "Passed" : "Missing"}</Badge>
                          </button>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            disabled={!isAdmin}
                            onClick={() => isAdmin && handleToggleField(item, "training_completed")}
                            className={cn("cursor-pointer disabled:cursor-default", !isAdmin && "pointer-events-none")}
                          >
                            <Badge variant={item.training_completed ? "success" : "warning"}>{item.training_completed ? "Done" : "Pending"}</Badge>
                          </button>
                        </td>
                        {isAdmin && (
                          <td className="py-3 px-4 text-center">
                            {item.id !== userId ? (
                              <button onClick={() => handleDeleteUser(item.id)} className="text-zinc-500 hover:text-rose-400 p-1 cursor-pointer rounded transition-colors" title="Delete user">
                                <Trash2 size={14} />
                              </button>
                            ) : (
                              <span className="text-xs text-zinc-600">Self</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>
      )}

      <Modal open={isAddOpen} onClose={() => setIsAddOpen(false)} title="Add Team Member" description="Provision a new employee under this organization.">
        <form onSubmit={handleAddUser} className="space-y-4">
          <Field label="Full name">
            <Input required value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Sarah Jenkins" />
          </Field>
          <Field label="Email address">
            <Input type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="sarah.j@company.com" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="System role">
              <Select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                {profileRole === "SuperAdmin" && <option value="SuperAdmin">SuperAdmin</option>}
                <option value="Employee">Employee</option>
                <option value="Admin">Admin</option>
                <option value="Editor">Editor</option>
                <option value="Auditor">Auditor</option>
                <option value="Viewer">Viewer</option>
              </Select>
            </Field>
            <Field label="Department">
              <Input list="department-options" value={newDept} onChange={(e) => setNewDept(e.target.value)} placeholder="General" />
              <datalist id="department-options">
                {departmentOptions.map((d) => <option key={d} value={d} />)}
              </datalist>
            </Field>
          </div>
          <div className="space-y-2 pt-2 border-t border-zinc-800">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={newBackground} onChange={(e) => setNewBackground(e.target.checked)} className="rounded bg-zinc-900 border-zinc-800" />
              <span className="text-zinc-300">Background check passed</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={newTraining} onChange={(e) => setNewTraining(e.target.checked)} className="rounded bg-zinc-900 border-zinc-800" />
              <span className="text-zinc-300">Security training completed</span>
            </label>
          </div>
          <Button type="submit" variant="primary" loading={submitting} className="w-full">
            {submitting ? "Provisioning…" : "Add member"}
          </Button>
        </form>
      </Modal>
    </PageContainer>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-zinc-300 font-medium text-right">{children}</dd>
    </div>
  );
}
