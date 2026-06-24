"use client";

import { UserProfile } from "@clerk/nextjs";
import { PageContainer, PageHeader, Card } from "../components/ui";

export default function AccountPage() {
  return (
    <PageContainer className="max-w-5xl">
      <PageHeader eyebrow="Account" title="Profile Settings" description="Manage your sign-in credentials, connected accounts, and security." />

      <Card>
          <UserProfile
            appearance={{
              variables: {
                colorPrimary: "#fafafa",
                colorBackground: "#121215",
                colorText: "#fafafa",
                colorTextSecondary: "#71717a",
                colorBorder: "#27272a",
                colorInputBackground: "#09090b",
                colorInputText: "#fafafa",
                borderRadius: "0.75rem",
              },
              elements: {
                rootBox: "w-full",
                cardBox: "w-full border-none shadow-none bg-transparent p-0",
                navbar: "border-r border-zinc-850 pr-4",
                navbarButton: "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/60 transition-colors text-xs py-2 rounded-lg",
                navbarButtonActive: "bg-zinc-800 text-zinc-100 font-medium",
                headerTitle: "text-zinc-150 font-semibold text-lg",
                headerSubtitle: "text-zinc-550 text-xs",
                profileSectionTitle: "text-zinc-300 border-zinc-800 text-xs font-bold uppercase tracking-wider pb-1 mt-6",
                buttonPrimary: "bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-xs font-medium py-2 px-3 rounded-lg border-none shadow-sm transition-colors",
                formButtonPrimary: "bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-xs font-medium rounded-lg",
                formFieldInput: "bg-zinc-950 border-zinc-800 text-zinc-100",
                modalContent: "bg-[#121215] border border-zinc-800 rounded-xl shadow-2xl p-6",
              },
            }}
          />
      </Card>
    </PageContainer>
  );
}
