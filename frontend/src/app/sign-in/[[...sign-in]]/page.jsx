import { SignIn } from "@clerk/nextjs";
import { ShieldCheck, Zap, ShieldAlert, FileText } from "lucide-react";

// Design tokens lifted from the "radiant-innovatech" handoff (GRC Guard AI.dc.html).
const C = {
  bg: "#080D18",
  card: "#0E1525",
  bd: "rgba(140,160,190,0.12)",
  bd2: "rgba(140,160,190,0.22)",
  tx: "#E6EBF4",
  t2: "#8C9BB3",
  t3: "#5A6C84",
  pri: "#4D8DF0",
  amber: "#F5A623",
  blue600: "#2563EB",
};

const FEATURES = [
  { icon: Zap, title: "AI control testing", desc: "Autonomous validation and recommended actions on every control." },
  { icon: ShieldAlert, title: "Unified risk intel", desc: "Frameworks, controls, and live evidence correlated in one console." },
  { icon: FileText, title: "Audit-ready reporting", desc: "Investigations and approvals captured for compliance review." },
];

// Clerk appearance themed to match the handoff's right-hand form panel.
const clerkAppearance = {
  variables: {
    colorPrimary: C.blue600,
    colorBackground: "transparent",
    colorText: C.tx,
    colorTextSecondary: C.t2,
    colorInputBackground: C.card,
    colorInputText: C.tx,
    colorNeutral: C.tx,
    colorDanger: "#F2767A",
    colorSuccess: "#3DD68C",
    colorWarning: "#E8B14C",
    borderRadius: "6px",
    fontFamily: "var(--font-inter), sans-serif",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "w-full shadow-none border-none",
    card: "bg-transparent shadow-none p-0 gap-5",
    header: "hidden",
    socialButtonsBlockButton:
      "h-[50px] bg-[#0E1525] border border-[rgba(140,160,190,0.12)] hover:border-[rgba(140,160,190,0.22)] transition-colors",
    socialButtonsBlockButtonText: "text-[#E6EBF4] font-medium",
    dividerLine: "bg-[rgba(140,160,190,0.12)]",
    dividerText: "text-[#5A6C84] text-[10px] font-bold tracking-[0.16em] uppercase",
    formFieldLabel: "text-[#E6EBF4] text-xs font-semibold",
    formFieldInput:
      "h-12 bg-[#0E1525] border-[rgba(140,160,190,0.12)] text-[#E6EBF4] rounded-md focus:border-[#4D8DF0]",
    formButtonPrimary:
      "h-[50px] bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[15px] font-semibold normal-case shadow-[0_8px_20px_-8px_rgba(37,99,235,0.7)]",
    footerAction: "text-[#8C9BB3]",
    footerActionLink: "text-[#F5A623] hover:text-[#F5A623]/80 font-bold",
    footer: "bg-transparent",
    identityPreviewEditButton: "text-[#4D8DF0]",
    formResendCodeLink: "text-[#4D8DF0]",
  },
};

export default function SignInPage() {
  return (
    <div className="flex min-h-screen" style={{ background: C.bg, color: C.tx }}>
      {/* LEFT — brand panel */}
      <div
        className="relative hidden lg:flex flex-1 min-w-0 overflow-hidden flex-col"
        style={{
          padding: "56px 64px",
          background: "linear-gradient(150deg,#0E1525 0%,#0B1120 55%,#070C16 100%)",
          backgroundImage: "radial-gradient(rgba(148,163,184,0.06) 1px,transparent 1px)",
          backgroundSize: "26px 26px",
        }}
      >
        {/* glow accents */}
        <div
          className="absolute pointer-events-none"
          style={{ top: -140, left: -90, width: 560, height: 560, filter: "blur(24px)", background: "radial-gradient(circle,rgba(37,99,235,0.16),transparent 70%)" }}
        />
        <div
          className="absolute pointer-events-none"
          style={{ bottom: -180, left: 120, width: 460, height: 460, filter: "blur(24px)", background: "radial-gradient(circle,rgba(245,158,11,0.07),transparent 70%)" }}
        />

        {/* logo lockup */}
        <div className="relative z-10 flex items-center gap-3">
          <div
            className="relative flex items-center justify-center"
            style={{ width: 46, height: 46, borderRadius: 12, background: "linear-gradient(140deg,#1D4ED8,#2563EB)", boxShadow: "0 8px 20px -6px rgba(37,99,235,0.6)" }}
          >
            <ShieldCheck size={24} strokeWidth={1.6} color="#fff" />
            <span className="absolute" style={{ top: -3, right: -3, width: 13, height: 13, borderRadius: "50%", background: C.amber, border: "2px solid #0B1120" }} />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em", color: C.tx }}>GRC Guard AI</div>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: C.t3, fontFamily: "ui-monospace, monospace" }}>
              Enterprise compliance
            </div>
          </div>
        </div>

        {/* hero + features */}
        <div className="relative z-10 my-auto" style={{ maxWidth: 520 }}>
          <h1 style={{ fontSize: 46, fontWeight: 800, lineHeight: 1.08, letterSpacing: "-0.035em", color: C.tx, margin: 0 }}>
            Compliance operations, accelerated by AI.
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.65, color: C.t2, margin: "22px 0 0", maxWidth: 440 }}>
            Audit, investigate, and report on governance risk from a single autonomous workspace built for modern GRC teams.
          </p>

          <div className="flex flex-col" style={{ gap: 22, marginTop: 44 }}>
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start" style={{ gap: 15 }}>
                <div
                  className="flex items-center justify-center shrink-0"
                  style={{ width: 38, height: 38, borderRadius: 9, background: C.card, border: `1px solid ${C.bd}`, color: C.pri }}
                >
                  <Icon size={19} strokeWidth={1.6} />
                </div>
                <div className="min-w-0">
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: C.tx }}>{title}</div>
                  <div style={{ fontSize: 13, lineHeight: 1.55, color: C.t2, marginTop: 3 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10" style={{ fontFamily: "ui-monospace, monospace", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: C.t3 }}>
          V2.4 · Governance, risk &amp; compliance
        </div>
      </div>

      {/* RIGHT — form panel */}
      <div
        className="flex-shrink-0 w-full lg:w-[540px] lg:max-w-[48vw] flex items-center justify-center overflow-y-auto"
        style={{ background: C.bg, borderLeft: `1px solid ${C.bd}`, padding: "48px 32px" }}
      >
        <div className="w-full" style={{ maxWidth: 392 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: C.amber, fontFamily: "ui-monospace, monospace" }}>
            GRC platform
          </div>
          <h2 style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em", color: C.tx, margin: "14px 0 0" }}>Sign in</h2>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: C.t2, margin: "10px 0 0" }}>
            Access the analyst workspace, integrations, reports, and audit trail.
          </p>

          <div className="mt-8">
            <SignIn
              routing="path"
              path="/sign-in"
              signUpUrl="/sign-up"
              fallbackRedirectUrl="/"
              forceRedirectUrl="/"
              appearance={clerkAppearance}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
