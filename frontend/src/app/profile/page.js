"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { 
  Users, Mail, Award, CheckCircle, ShieldAlert, 
  Search, Bell, UserPlus, Trash2, Edit2, Shield,
  Building, Calendar, Check, X, ShieldCheck
} from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/backend";

export default function ProfilePage() {
  const { userId, getToken } = useAuth();
  const { user: clerkUser } = useUser();
  const [activeSubTab, setActiveSubTab] = useState("profile");
  const [people, setPeople] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");

  // Modal / Add user state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("Employee");
  const [newDept, setNewDept] = useState("General");
  const [newTraining, setNewTraining] = useState(false);
  const [newBackground, setNewBackground] = useState(false);
  
  // Current user details resolved from DB roster
  const [me, setMe] = useState(null);

  const fetchPeople = useCallback(async () => {
    try {
      const token = await getToken();
      const headers = { "Authorization": `Bearer ${token}` };
      const [peopleRes, sessionRes, departmentsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/people`, { headers }),
        fetch(`${API_BASE_URL}/api/auth/session`, { headers }),
        fetch(`${API_BASE_URL}/api/departments`, { headers })
      ]);

      const data = peopleRes.ok ? await peopleRes.json() : [];
      const session = sessionRes.ok ? await sessionRes.json() : null;
      const departmentData = departmentsRes.ok ? await departmentsRes.json() : [];
      const fallbackUser = {
        id: userId,
        name: clerkUser?.fullName || "Active User",
        email: clerkUser?.primaryEmailAddress?.emailAddress || "",
        role: "Employee",
        department: "General",
        status: "Active",
        training_completed: false,
        background_check_passed: false
      };

      setPeople(data);
      setDepartments(departmentData);
      setMe(session || data.find(p => p.id === userId) || fallbackUser);
    } catch (err) {
      console.error("Failed to load people database:", err);
    } finally {
      setLoading(false);
    }
  }, [getToken, userId, clerkUser]);

  useEffect(() => {
    fetchPeople();
  }, [fetchPeople]);

  const handleAddUser = async (e) => {
    e.preventDefault();
    if (!newName || !newEmail) return;
    setSubmitting(true);

    try {
      const token = await getToken();
      const headers = { 
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      };
      const payload = {
        name: newName,
        email: newEmail,
        role: newRole,
        department: newDept,
        training_completed: newTraining,
        background_check_passed: newBackground,
        status: "Active"
      };

      const res = await fetch(`${API_BASE_URL}/api/people`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setIsAddOpen(false);
        setNewName("");
        setNewEmail("");
        setNewRole("Employee");
        setNewDept("General");
        setNewTraining(false);
        setNewBackground(false);
        fetchPeople();
      } else {
        const errData = await res.json();
        alert(errData.detail || "Failed to create user.");
      }
    } catch (err) {
      alert("Failed to add user due to connection error.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteUser = async (id) => {
    if (id === userId) {
      alert("You cannot delete your own active session account.");
      return;
    }
    if (!confirm("Are you sure you want to remove this user from the organization?")) return;

    try {
      const token = await getToken();
      const headers = { "Authorization": `Bearer ${token}` };
      const res = await fetch(`${API_BASE_URL}/api/people/${id}`, {
        method: "DELETE",
        headers
      });
      if (res.ok) {
        fetchPeople();
      } else {
        alert("Failed to remove user.");
      }
    } catch (err) {
      alert("Connection error occurred while removing user.");
    }
  };

  const handleToggleBackground = async (person) => {
    try {
      const token = await getToken();
      const headers = { 
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      };
      await fetch(`${API_BASE_URL}/api/people/${person.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ background_check_passed: !person.background_check_passed })
      });
      fetchPeople();
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleTraining = async (person) => {
    try {
      const token = await getToken();
      const headers = { 
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      };
      await fetch(`${API_BASE_URL}/api/people/${person.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ training_completed: !person.training_completed })
      });
      fetchPeople();
    } catch (err) {
      console.error(err);
    }
  };

  const isAdmin = ["Admin", "SuperAdmin"].includes(me?.role);
  const profileName = me?.name || clerkUser?.fullName || "Active User";
  const profileEmail = me?.email || clerkUser?.primaryEmailAddress?.emailAddress || "Not available";
  const profileDepartment = me?.department || "General";
  const profileRole = me?.role || "Employee";
  const profileStatus = me?.status || "Active";
  const departmentOptions = departments.length
    ? departments.map(department => department.name)
    : Array.from(new Set(people.map(person => person.department || "General")));

  const filtered = people.filter(p => 
    (p.name || "").toLowerCase().includes(search.toLowerCase()) || 
    (p.email || "").toLowerCase().includes(search.toLowerCase()) ||
    (p.department || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 sm:space-y-8 max-w-7xl mx-auto w-full">
      {/* Header */}
      <div>
        <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Enterprise Directory</span>
        <h2 className="text-2xl font-semibold text-zinc-100 tracking-tight mt-0.5">Profile & Team Management</h2>
        <p className="text-zinc-400 text-xs mt-0.5">
          View your secure profile credentials and manage department users.
        </p>
      </div>

      {/* Sub-Tabs */}
      <div className="flex border-b border-zinc-850 space-x-6 text-xs pb-px">
        <button
          onClick={() => setActiveSubTab("profile")}
          className={`pb-2.5 font-medium border-b-2 transition-all cursor-pointer ${
            activeSubTab === "profile" 
              ? "border-zinc-100 text-zinc-100" 
              : "border-transparent text-zinc-500 hover:text-zinc-300"
          }`}
        >
          My Profile
        </button>
        <button
          onClick={() => setActiveSubTab("database")}
          className={`pb-2.5 font-medium border-b-2 transition-all cursor-pointer ${
            activeSubTab === "database" 
              ? "border-zinc-100 text-zinc-100" 
              : "border-transparent text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Database Registry
        </button>
      </div>

      {/* Tab Panels */}
      <div className="min-h-[400px]">
        {/* Sub-Tab 1: Profile Details */}
        {activeSubTab === "profile" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8 items-start animate-fadeIn">
            {/* Profile Card */}
            <div className="bg-[#121215] border border-zinc-800/80 rounded-xl p-5 shadow-sm space-y-4 md:col-span-1">
              <div className="flex items-center space-x-3.5 pb-4 border-b border-zinc-850">
                <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center font-semibold text-zinc-100 text-lg border border-zinc-700 shrink-0">
                  {profileName.substring(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-zinc-200 text-sm truncate">{profileName}</h3>
                  <span className="block text-[10px] text-zinc-500 font-mono truncate">{me?.id || userId}</span>
                </div>
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
                  <span className="text-zinc-500">Email Address</span>
                  <span className="text-zinc-355 font-medium break-all sm:text-right">{profileEmail}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">Department</span>
                  <span className="text-zinc-355 font-medium text-right">{profileDepartment}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">System Role</span>
                  <span className="text-zinc-355 font-semibold flex items-center text-right">
                    <Shield size={12} className="mr-1 text-zinc-400" />
                    {profileRole}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">Account Status</span>
                  <span className="text-zinc-355 font-medium text-right">{profileStatus}</span>
                </div>
                <div className="flex justify-between items-center pt-1">
                  <span className="text-zinc-500">Training Check</span>
                  {me?.training_completed ? (
                    <span className="text-[9px] bg-emerald-500/10 text-emerald-450 border border-emerald-500/20 px-2 py-0.5 rounded">Passed</span>
                  ) : (
                    <span className="text-[9px] bg-amber-500/10 text-amber-405 border border-amber-500/20 px-2 py-0.5 rounded">Pending</span>
                  )}
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500">Background Check</span>
                  {me?.background_check_passed ? (
                    <span className="text-[9px] bg-emerald-500/10 text-emerald-455 border border-emerald-500/20 px-2 py-0.5 rounded">Verified</span>
                  ) : (
                    <span className="text-[9px] bg-rose-500/10 text-rose-455 border border-rose-500/20 px-2 py-0.5 rounded">Missing</span>
                  )}
                </div>
              </div>
            </div>

            {/* Company Info */}
            <div className="bg-[#121215] border border-zinc-800/80 rounded-xl p-5 shadow-sm space-y-4 lg:col-span-2">
              <div className="flex items-center space-x-2 text-zinc-200">
                <Building size={16} className="text-zinc-455" />
                <h3 className="font-semibold text-xs uppercase tracking-wider">Company Scope</h3>
              </div>
              <div className="space-y-3 text-xs">
                <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
                  <span className="text-zinc-500">Company</span>
                  <span className="text-zinc-355 font-medium">ARB Apex Bank</span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
                  <span className="text-zinc-500">Compliance Scope</span>
                  <span className="text-zinc-355 sm:text-right">SOC 2 Type II / GDPR / Basel III / CBEST</span>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
                  <span className="text-zinc-500">Operating Model</span>
                  <span className="text-emerald-450 font-semibold">Active & Audited</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sub-Tab 2: Database Registry */}
        {activeSubTab === "database" && (
          <div className="space-y-4 animate-fadeIn">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {departments.map((department) => (
                <div key={department.id || department.name} className="bg-[#121215] border border-zinc-800/80 rounded-lg p-4 min-h-28">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Department</p>
                      <h4 className="mt-1 text-sm font-semibold text-zinc-100 truncate">{department.name}</h4>
                    </div>
                    <span className="text-[9px] border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded">
                      {department.status || "Active"}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-zinc-500 line-clamp-2">
                    {department.description || "No department description recorded."}
                  </p>
                  <div className="mt-3 flex items-center justify-between text-[10px] text-zinc-500">
                    <span>{department.users_count || 0} users</span>
                    <span>{department.controls_count || 0} controls</span>
                    <span>{department.risks_count || 0} risks</span>
                  </div>
                </div>
              ))}
            </div>

          <div className="bg-[#121215] border border-zinc-800/80 rounded-xl p-4 sm:p-5 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h3 className="font-semibold text-zinc-150 text-sm">Compliance registry directory</h3>
                <p className="text-[10px] text-zinc-500 mt-0.5">Manage permissions, onboarding, and auditing parameters for all department users.</p>
              </div>

              {isAdmin && (
                <button
                  onClick={() => setIsAddOpen(true)}
                  className="bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-medium py-1.5 px-3 rounded-lg text-xs flex items-center space-x-1 cursor-pointer transition-colors"
                >
                  <UserPlus size={14} />
                  <span>Add Member</span>
                </button>
              )}
            </div>

            {/* Filter and Search */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-3 text-zinc-550" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, department..."
                className="w-full bg-zinc-900 border border-zinc-800 hover:border-zinc-700 focus:border-zinc-650 text-zinc-200 rounded-lg pl-9 pr-4 py-2 text-xs focus:outline-none transition-all placeholder-zinc-600"
              />
            </div>

            {/* Team Table */}
            <div className="border border-zinc-850 rounded-lg overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-zinc-900/40 border-b border-zinc-850 text-zinc-500 font-medium uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Name</th>
                    <th className="py-3 px-4">Department</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4 text-center">Background</th>
                    <th className="py-3 px-4 text-center">Training</th>
                    {isAdmin && <th className="py-3 px-4 text-center w-20">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={isAdmin ? 6 : 5} className="py-8 text-center text-zinc-500">Loading directory roster...</td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={isAdmin ? 6 : 5} className="py-8 text-center text-zinc-500">No matching team members found.</td>
                    </tr>
                  ) : (
                    filtered.map((item) => (
                      <tr key={item.id} className="border-b border-zinc-850/50 hover:bg-zinc-900/10 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-medium text-zinc-200">{item.name || "Unnamed User"}</div>
                          <div className="text-[10px] text-zinc-500 font-mono">{item.email || "No email"}</div>
                        </td>
                        <td className="py-3 px-4 text-zinc-400 font-medium">{item.department || "General"}</td>
                        <td className="py-3 px-4 text-zinc-400 font-semibold">{item.role || "Employee"}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center">
                            {isAdmin ? (
                              <button
                                onClick={() => handleToggleBackground(item)}
                                className={`text-[10px] font-medium py-0.5 px-2 rounded-md border cursor-pointer transition-all ${
                                  item.background_check_passed 
                                    ? "bg-emerald-500/5 text-emerald-450 border-emerald-500/20 hover:bg-emerald-500/10" 
                                    : "bg-rose-500/5 text-rose-455 border-rose-500/20 hover:bg-rose-500/10"
                                }`}
                              >
                                {item.background_check_passed ? "Passed" : "Missing"}
                              </button>
                            ) : (
                              <span className={`text-[10px] font-medium py-0.5 px-2 rounded-md border ${
                                item.background_check_passed 
                                  ? "bg-emerald-500/5 text-emerald-450 border-emerald-500/20" 
                                  : "bg-rose-500/5 text-rose-455 border-rose-500/20"
                              }`}>
                                {item.background_check_passed ? "Passed" : "Missing"}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center">
                            {isAdmin ? (
                              <button
                                onClick={() => handleToggleTraining(item)}
                                className={`text-[10px] font-medium py-0.5 px-2 rounded-md border cursor-pointer transition-all ${
                                  item.training_completed 
                                    ? "bg-emerald-500/5 text-emerald-455 border-emerald-500/20 hover:bg-emerald-500/10" 
                                    : "bg-amber-500/5 text-amber-500 border-amber-500/20 hover:bg-amber-500/10"
                                }`}
                              >
                                {item.training_completed ? "Done" : "Pending"}
                              </button>
                            ) : (
                              <span className={`text-[10px] font-medium py-0.5 px-2 rounded-md border ${
                                item.training_completed 
                                  ? "bg-emerald-500/5 text-emerald-455 border-emerald-500/20" 
                                  : "bg-amber-500/5 text-amber-500 border-amber-500/20"
                              }`}>
                                {item.training_completed ? "Done" : "Pending"}
                              </span>
                            )}
                          </div>
                        </td>
                        {isAdmin && (
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-center">
                              {item.id !== userId ? (
                                <button
                                  onClick={() => handleDeleteUser(item.id)}
                                  className="text-zinc-550 hover:text-rose-400 p-1 cursor-pointer rounded transition-colors"
                                  title="Delete User"
                                >
                                  <Trash2 size={13} />
                                </button>
                              ) : (
                                <span className="text-[10px] text-zinc-650">Self</span>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          </div>
        )}

      </div>

      {/* Add User Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[#121215] border border-zinc-800 rounded-xl max-w-sm w-full p-6 shadow-2xl space-y-5 relative animate-fadeIn">
            <button 
              onClick={() => setIsAddOpen(false)}
              className="absolute right-4 top-4 text-zinc-550 hover:text-zinc-100 cursor-pointer"
            >
              <X size={16} />
            </button>

            <div className="space-y-1">
              <h3 className="font-semibold text-zinc-100 text-md">Add Team Member</h3>
              <p className="text-zinc-400 text-xs">Provision a new employee under this organization.</p>
            </div>

            <form onSubmit={handleAddUser} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wide">Full Name</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Sarah Jenkins"
                  className="w-full bg-zinc-900 border border-zinc-800 hover:border-zinc-700 focus:border-zinc-650 text-zinc-200 rounded-lg p-2 text-xs focus:outline-none transition-all placeholder-zinc-650"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wide">Email Address</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="sarah.j@company.com"
                  className="w-full bg-zinc-900 border border-zinc-800 hover:border-zinc-700 focus:border-zinc-650 text-zinc-200 rounded-lg p-2 text-xs focus:outline-none transition-all placeholder-zinc-650"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wide">System Role</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 hover:border-zinc-700 focus:border-zinc-650 text-zinc-200 rounded-lg p-2 text-xs focus:outline-none transition-all"
                  >
                    {profileRole === "SuperAdmin" && <option value="SuperAdmin">SuperAdmin</option>}
                    <option value="Employee">Employee</option>
                    <option value="Admin">Admin</option>
                    <option value="Editor">Editor</option>
                    <option value="Auditor">Auditor</option>
                    <option value="Viewer">Viewer</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wide">Department</label>
                  <input
                    type="text"
                    list="department-options"
                    value={newDept}
                    onChange={(e) => setNewDept(e.target.value)}
                    placeholder="General"
                    className="w-full bg-zinc-900 border border-zinc-800 hover:border-zinc-700 focus:border-zinc-650 text-zinc-200 rounded-lg p-2 text-xs focus:outline-none transition-all placeholder-zinc-650"
                  />
                  <datalist id="department-options">
                    {departmentOptions.map((department) => (
                      <option key={department} value={department} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-zinc-850">
                <label className="flex items-center space-x-2 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newBackground}
                    onChange={(e) => setNewBackground(e.target.checked)}
                    className="rounded bg-zinc-900 border-zinc-800 text-zinc-100 focus:ring-0"
                  />
                  <span className="text-zinc-300">Background check passed</span>
                </label>

                <label className="flex items-center space-x-2 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newTraining}
                    onChange={(e) => setNewTraining(e.target.checked)}
                    className="rounded bg-zinc-900 border-zinc-800 text-zinc-100 focus:ring-0"
                  />
                  <span className="text-zinc-300">Security training completed</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-medium py-2 px-4 rounded-lg text-xs active:scale-98 transition-all shadow-sm"
              >
                {submitting ? "Provisioning..." : "Add Member"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}



