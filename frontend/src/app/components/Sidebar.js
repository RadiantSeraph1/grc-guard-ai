"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { UserButton, SignOutButton, useAuth } from "@clerk/nextjs";
import {
  LayoutDashboard, ShieldCheck, FileText, AlertTriangle,
  Users, FolderKanban, ShieldAlert, Library, Database,
  Scale, FileCode, Cpu, Settings, ChevronLeft, ChevronRight,
  Activity, Radio, Link2, LogOut, Layers, ClipboardList, Bell, FileBarChart
} from "lucide-react";
import { API_BASE_URL } from "../lib/api";

export default function Sidebar() {
  const pathname = usePathname();
  const { getToken } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [apiStatus, setApiStatus] = useState("checking");
  const [unreadCount, setUnreadCount] = useState(0);

  // Check API health status
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/health`)
      .then((res) => res.json())
      .then((data) => {
        if (data.status === "healthy") {
          setApiStatus("online");
        } else {
          setApiStatus("offline");
        }
      })
      .catch(() => setApiStatus("offline"));
  }, [pathname]);

  // Poll unread notification count
  useEffect(() => {
    let active = true;
    const fetchUnread = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${API_BASE_URL}/api/notifications?unread_only=true`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (active) setUnreadCount(data.unread_count || 0);
      } catch { /* ignore */ }
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => { active = false; clearInterval(interval); };
  }, [getToken, pathname]);

  const navItems = [
    { category: "OVERVIEW", items: [
      { name: "Dashboard", href: "/", icon: LayoutDashboard },
      { name: "Notifications", href: "/notifications", icon: Bell, badge: unreadCount }
    ]},
    { category: "GOVERNANCE", items: [
      { name: "Controls Monitor", href: "/controls", icon: ShieldCheck },
      { name: "Frameworks Library", href: "/frameworks", icon: Layers },
      { name: "Remediation Tasks", href: "/tasks", icon: ClipboardList },
      { name: "Policies Manager", href: "/policies", icon: FileText }
    ]},
    { category: "RISK & VENDORS", items: [
      { name: "Risk Register", href: "/risks", icon: AlertTriangle },
      { name: "Vendor Risk (TPRM)", href: "/vendors", icon: FolderKanban }
    ]},
    { category: "COMPLIANCE & EVIDENCE", items: [
      { name: "Integrations Center", href: "/integrations", icon: Link2 },
      { name: "AI Scanner & RAG", href: "/scanner", icon: ShieldAlert },
      { name: "Evidence Library", href: "/evidence", icon: Library }
    ]},
    { category: "OPERATIONS", items: [
      { name: "Asset Inventory", href: "/assets", icon: Database },
      { name: "People Directory", href: "/people", icon: Users }
    ]},
    { category: "AUDIT & TRUST", items: [
      { name: "Auditor Portal", href: "/audit", icon: Scale },
      { name: "Compliance Reports", href: "/reports", icon: FileBarChart },
      { name: "Trust Center", href: "/trust", icon: FileCode }
    ]},
    { category: "COGNITIVES", items: [
      { name: "AI Agents Center", href: "/ai", icon: Cpu },
      { name: "Benchmark Evaluation", href: "/evaluation", icon: Activity }
    ]},
    { category: "PROJECT CLOSURE", items: [
      { name: "Implementation Report", href: "/implementation", icon: FileCode }
    ]},
    { category: "SYSTEM", items: [
      { name: "Settings", href: "/settings", icon: Settings },
      { name: "My Profile & Team", href: "/profile", icon: Users }
    ]}
  ];

  const isExpanded = !isCollapsed || isHovered;

  const mobileItems = [
    { name: "Home", href: "/", icon: LayoutDashboard },
    { name: "Controls", href: "/controls", icon: ShieldCheck },
    { name: "Risks", href: "/risks", icon: AlertTriangle },
    { name: "AI", href: "/ai", icon: Cpu },
    { name: "Settings", href: "/settings", icon: Settings }
  ];

  return (
    <>
    <div
      className={`desktop-sidebar shrink-0 transition-all duration-300 ease-in-out ${
        isCollapsed ? "w-16" : "w-60"
      }`}
    >
      <div
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`fixed top-0 left-0 h-screen z-50 bg-[#09090b] border-r border-zinc-800/80 text-zinc-450 flex flex-col transition-all duration-300 ease-in-out ${
          isExpanded ? "w-60 shadow-xl shadow-black/40" : "w-16"
        }`}
      >
        {/* Header / Brand */}
        <div className={`flex flex-col p-4 border-b border-zinc-850 transition-all ${
          isExpanded ? "h-24 justify-between" : "h-14 items-center justify-center"
        }`}>
          <div className="flex items-center justify-between w-full">
            {isExpanded && (
              <div className="flex items-center space-x-2">
                <Image src="/grc-guard-logo.svg" alt="GRC Guard AI" width={24} height={24} className="w-6 h-6 rounded-md shadow-sm" />
                <div>
                  <h1 className="font-medium text-zinc-150 text-xs tracking-wide">GRC GUARD AI</h1>
                  <span className="text-[9px] text-zinc-500 font-semibold tracking-wider uppercase">Enterprise</span>
                </div>
              </div>
            )}
            {!isExpanded && (
              <div className="w-full flex justify-center">
                <Image src="/grc-guard-logo.svg" alt="GRC Guard AI" width={28} height={28} className="w-7 h-7 rounded-lg shadow-sm" />
              </div>
            )}
            
            {/* Toggle Button */}
            <button 
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="absolute -right-3 top-4 bg-zinc-900 border border-zinc-800 hover:border-zinc-500 text-zinc-450 hover:text-zinc-100 rounded-full p-1 cursor-pointer transition-colors z-50"
            >
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
            </button>
          </div>

          {isExpanded && (
            <div className="w-full">
              <Link
                href="/profile"
                className="w-full bg-zinc-900 hover:bg-zinc-850 text-zinc-200 border border-zinc-800 text-[10px] h-7 px-2.5 rounded-lg shadow-sm flex items-center justify-between transition-colors"
              >
                <span className="truncate">ARB Apex Bank</span>
                <span className="text-zinc-500">Departments</span>
              </Link>
            </div>
          )}
        </div>

        {/* Nav List - completely hidden scrollbar */}
        <div className="flex-1 overflow-y-auto py-4 px-2 space-y-4 no-scrollbar">
          {navItems.map((group, idx) => (
            <div key={idx} className="space-y-0.5">
              {isExpanded && (
                <h3 className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest px-3 mb-1.5">
                  {group.category}
                </h3>
              )}
              {group.items.map((item, itemIdx) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={itemIdx}
                    href={item.href}
                    className={`relative flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-xs transition-all duration-150 ${
                      isActive
                        ? "bg-zinc-800/80 text-zinc-100 font-medium"
                        : "hover:bg-zinc-900/60 hover:text-zinc-200"
                    }`}
                  >
                    <span className="relative">
                      <Icon size={14} className={isActive ? "text-zinc-150" : "text-zinc-500"} />
                      {item.badge > 0 && !isExpanded && (
                        <span className="absolute -top-1.5 -right-1.5 w-1.5 h-1.5 rounded-full bg-rose-500" />
                      )}
                    </span>
                    {isExpanded && <span className="truncate flex-1">{item.name}</span>}
                    {isExpanded && item.badge > 0 && (
                      <span className="text-[9px] font-bold bg-rose-500 text-white rounded-full px-1.5 py-0.5 min-w-[16px] text-center">
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer / Auth */}
        <div className="p-3 border-t border-zinc-850 flex flex-col space-y-2 bg-[#09090b]">
          <div className="flex items-center justify-between">
            {isExpanded ? (
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center space-x-2">
                  <UserButton afterSignOutUrl="/" userProfileMode="navigation" userProfileUrl="/account" />
                  <div className="flex flex-col">
                    <span className="text-[10px] font-medium text-zinc-200 truncate max-w-[90px]">My Account</span>
                    <span className="text-[8px] text-zinc-500">Security Vault</span>
                  </div>
                </div>
                <SignOutButton redirectUrl="/">
                  <button className="text-zinc-500 hover:text-rose-400 p-1.5 rounded hover:bg-zinc-900/65 cursor-pointer transition-colors" title="Log Out">
                    <LogOut size={12} />
                  </button>
                </SignOutButton>
              </div>
            ) : (
              <div className="w-full flex justify-center">
                <UserButton afterSignOutUrl="/" userProfileMode="navigation" userProfileUrl="/account" />
              </div>
            )}
          </div>

          {/* API Status Badge */}
          {isExpanded && (
            <div className="flex items-center justify-between text-[8px] text-zinc-500 pt-0.5 border-t border-zinc-850/50">
              <span className="flex items-center">
                <Radio size={8} className="mr-1 text-zinc-650" />
                API Gateway
              </span>
              <span className={`font-semibold flex items-center ${
                apiStatus === "online" ? "text-emerald-400" : "text-rose-450"
              }`}>
                <span className={`w-1 h-1 rounded-full mr-1 ${
                  apiStatus === "online" ? "bg-emerald-400 animate-pulse" : "bg-rose-450"
                }`} />
                {apiStatus.toUpperCase()}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
    <nav className="mobile-bottom-nav fixed bottom-0 left-0 right-0 z-50 bg-[#09090b]/95 backdrop-blur border-t border-zinc-800 px-2 py-2 hidden">
      <div className="grid grid-cols-5 gap-1">
        {mobileItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-1 rounded-lg py-2 text-[9px] font-medium ${
                active ? "bg-zinc-800 text-zinc-100" : "text-zinc-500"
              }`}
            >
              <Icon size={15} />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
    </>
  );
}




