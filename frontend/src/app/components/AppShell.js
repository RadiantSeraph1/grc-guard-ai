"use client";

import { SignedIn, SignedOut, RedirectToSignIn } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import { OfflineBanner } from "./ui";

const PUBLIC_ROUTES = ["/super-admin", "/super-admin/login", "/sign-in", "/sign-up"];

export default function AppShell({ children }) {
  const pathname = usePathname();

  if (PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return (
      <div className="flex-1 flex flex-col min-w-0 h-screen min-h-0">
        <OfflineBanner />
        <div className="app-content flex-1 min-w-0 min-h-0 overflow-y-auto bg-[#09090b] relative custom-scrollbar">
          {children}
        </div>
      </div>
    );
  }

  return (
    <>
      <SignedOut>
        {/* Send signed-out users to the designed login screen at /sign-in. */}
        <RedirectToSignIn />
      </SignedOut>

      <SignedIn>
        <div className="flex w-full h-screen min-h-0 overflow-hidden">
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <OfflineBanner />
            <div className="app-content flex-1 min-w-0 min-h-0 overflow-y-auto bg-[#09090b] relative custom-scrollbar">
              {children}
            </div>
          </div>
        </div>
      </SignedIn>
    </>
  );
}
