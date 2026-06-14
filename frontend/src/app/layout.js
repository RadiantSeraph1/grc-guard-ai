import { ClerkProvider } from "@clerk/nextjs";
import { Inter } from "next/font/google";
import AppShell from "./components/AppShell";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata = {
  title: "GRC Guard AI - Governance, Risk & Compliance Platform",
  description: "Enterprise compliance monitoring, real-world integrations, automated evidence collections, and AI RAG compliance auditor analysis.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" }
    ],
    shortcut: "/icon.svg",
    apple: "/grc-guard-logo.svg"
  },
};

export default function RootLayout({ children }) {
  return (
    <ClerkProvider publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}>
      <html suppressHydrationWarning lang="en" className={`${inter.variable} h-full antialiased dark`}>
        <body suppressHydrationWarning className="min-h-full bg-[#09090b] font-sans text-zinc-100 flex overflow-hidden">
          <AppShell>{children}</AppShell>
        </body>
      </html>
    </ClerkProvider>
  );
}
