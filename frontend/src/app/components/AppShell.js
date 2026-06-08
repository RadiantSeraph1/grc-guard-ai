"use client";

import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import Image from "next/image";
import Sidebar from "./Sidebar";

const PUBLIC_ROUTES = new Set(["/super-admin", "/super-admin/login"]);

export default function AppShell({ children }) {
  const pathname = usePathname();

  if (PUBLIC_ROUTES.has(pathname)) {
    return (
      <div className="app-content flex-1 min-w-0 h-screen min-h-0 overflow-y-auto bg-[#09090b] relative custom-scrollbar">
        {children}
      </div>
    );
  }

  return (
    <>
      <SignedOut>
        <div className="flex flex-col items-center justify-center w-full min-h-screen bg-[#09090b] relative overflow-hidden px-4">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-zinc-800/10 rounded-full blur-[120px] pointer-events-none" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-zinc-800/15 rounded-full blur-[120px] pointer-events-none" />

          <div className="z-10 flex flex-col items-center max-w-md w-full text-center space-y-8 bg-[#121215] p-8 rounded-2xl border border-zinc-800 shadow-2xl">
            <Image
              src="/grc-guard-logo.svg"
              alt="GRC Guard AI"
              width={56}
              height={56}
              className="w-14 h-14 rounded-2xl shadow-xl shadow-white/5"
              priority
            />

            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">GRC Guard AI</h1>
              <p className="text-zinc-400 text-xs leading-relaxed">
                Log in to access your enterprise compliance dashboard, audits, risks, and automated integrations.
              </p>
            </div>

            <div className="w-full pt-2">
              <SignInButton
                mode="modal"
                className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-medium py-3 px-4 rounded-xl cursor-pointer shadow-md active:scale-[0.98] transition-all duration-150 text-xs"
              >
                Sign In to Dashboard
              </SignInButton>
            </div>

            <div className="flex items-center justify-center space-x-6 text-[9px] text-zinc-500 uppercase tracking-widest pt-2">
              <span>Basel III/IV</span>
              <span>GDPR</span>
              <span>SOC 2</span>
              <span>CBEST</span>
            </div>
          </div>
        </div>
      </SignedOut>

      <SignedIn>
        <div className="flex w-full h-screen min-h-0 overflow-hidden">
          <Sidebar />
          <div className="app-content flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto bg-[#09090b] relative custom-scrollbar">
            {children}
          </div>
        </div>
      </SignedIn>
    </>
  );
}
