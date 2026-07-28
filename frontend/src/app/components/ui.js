"use client";

import React, { useState, useEffect } from "react";
import { Search as SearchIcon, X, AlertTriangle, RotateCw, WifiOff, Star } from "lucide-react";
import { Toaster as SonnerToaster, toast } from 'sonner';

/**
 * Shared UI primitives for GRC Guard AI.
 *
 * These exist to (1) kill the per-page duplication of cards/badges/skeletons
 * and (2) standardize the type scale and spacing so the app stops relying on
 * unreadable 8–10px text. Prefer these over bespoke markup in pages.
 */

/** Tiny classnames joiner (no dependency needed). */
export function cn(...parts) {
  return parts.filter(Boolean).join(" ");
}

/* ── Connectivity ───────────────────────────────────────────────────── */

/** True/false browser online state, live-updated via the online/offline events. */
export function useOnlineStatus() {
  // navigator.onLine is undefined during SSR - default true so the banner
  // never flashes on first paint, only once the browser actually reports offline.
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}

/** App-wide "you're offline" banner - mounted once in AppShell, not per-page. */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div className="flex items-center justify-center gap-2 bg-rose-500/10 border-b border-rose-500/20 text-rose-300 text-xs font-medium py-2 px-4 shrink-0">
      <WifiOff size={13} />
      You&apos;re offline — changes won&apos;t save until your connection is back.
    </div>
  );
}

/* ── Layout ─────────────────────────────────────────────────────────── */

export function PageContainer({ children, className }) {
  return (
    <div className={cn("p-6 sm:p-8 space-y-8 max-w-7xl mx-auto w-full ui-fade-in", className)}>
      {children}
    </div>
  );
}

/**
 * PageHeader — consistent title block. `eyebrow` is the small uppercase label,
 * `title` the h1, `description` the subtext, `actions` renders right-aligned.
 */
export function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
            {eyebrow}
          </span>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 mt-1">{title}</h1>
        {description && <p className="text-sm text-zinc-400 mt-1.5 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

/* ── Card ───────────────────────────────────────────────────────────── */

export function Card({ children, className, hover = false, as: Tag = "div", ...rest }) {
  return (
    <Tag className={cn("ui-card", hover && "ui-card-hover", "p-5", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, description, action }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/* ── StatCard ───────────────────────────────────────────────────────── */

const TREND_STYLES = {
  up: "text-emerald-400",
  down: "text-rose-400",
  neutral: "text-zinc-500",
};

/**
 * StatCard — the KPI tile. `delta` is optional and ONLY rendered when a real
 * value is provided (no fabricated "+4.2%" placeholders).
 */
export function StatCard({ label, value, suffix, icon: Icon, accent = "zinc", delta, footer }) {
  const accentRing = {
    zinc: "text-zinc-400 bg-zinc-800/40 border-zinc-700/40",
    danger: "text-rose-400 bg-rose-500/10 border-rose-500/20",
    warning: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    success: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    accent: "text-indigo-300 bg-indigo-500/10 border-indigo-500/20",
  }[accent];

  return (
    <Card hover className="flex items-start justify-between">
      <div className="space-y-2 min-w-0">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
        <div className="flex items-baseline gap-1">
          <AnimatedCounter value={value} className="text-3xl font-semibold tracking-tight text-zinc-50 tabular-nums" />
          {suffix && <span className="text-sm text-zinc-500">{suffix}</span>}
        </div>
        {delta && (
          <span className={cn("text-xs font-medium", TREND_STYLES[delta.direction] || TREND_STYLES.neutral)}>
            {delta.label}
          </span>
        )}
        {footer && <span className="block text-xs text-zinc-500">{footer}</span>}
      </div>
      {Icon && (
        <div className={cn("w-10 h-10 rounded-lg border flex items-center justify-center shrink-0", accentRing)}>
          <Icon size={18} />
        </div>
      )}
    </Card>
  );
}

/* ── Badge ──────────────────────────────────────────────────────────── */

const BADGE_VARIANTS = {
  neutral: "bg-zinc-800/60 text-zinc-300 border-zinc-700/50",
  success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  danger: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  accent: "bg-indigo-500/10 text-indigo-300 border-indigo-500/20",
};

export function Badge({ children, variant = "neutral", className }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md border",
        BADGE_VARIANTS[variant] || BADGE_VARIANTS.neutral,
        className
      )}
    >
      {children}
    </span>
  );
}

/** Maps common GRC status strings to a badge variant. */
export function statusVariant(status) {
  const s = String(status || "").toLowerCase();
  if (["passing", "connected", "approved", "current", "mitigated", "active"].includes(s)) return "success";
  if (["warning", "under review", "under assessment", "expiring", "configured", "draft"].includes(s)) return "warning";
  if (["failing", "flagged", "expired", "open", "disconnected", "violation"].includes(s)) return "danger";
  return "neutral";
}

/* ── Button ─────────────────────────────────────────────────────────── */

const BUTTON_VARIANTS = {
  primary: "bg-indigo-600 hover:bg-indigo-500 text-white border-transparent",
  secondary: "bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border-zinc-800 hover:border-zinc-700",
  ghost: "bg-transparent hover:bg-zinc-800/50 text-zinc-300 border-transparent",
  danger: "bg-rose-600/90 hover:bg-rose-600 text-white border-transparent",
};

export function Button({
  children,
  variant = "secondary",
  size = "md",
  icon: Icon,
  loading = false,
  className,
  disabled,
  as: Tag = "button",
  ...rest
}) {
  const sizes = {
    sm: "text-xs px-2.5 py-1.5 gap-1.5",
    md: "text-sm px-3.5 py-2 gap-2",
    lg: "text-sm px-4 py-2.5 gap-2",
  };
  const isButton = Tag === "button";
  return (
    <Tag
      {...(isButton ? { disabled: disabled || loading } : {})}
      className={cn(
        "inline-flex items-center justify-center font-medium rounded-lg border cursor-pointer",
        "transition-colors disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]",
        BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.secondary,
        sizes[size],
        className
      )}
      {...rest}
    >
      {Icon && <Icon size={size === "sm" ? 13 : 15} className={loading ? "animate-spin" : ""} />}
      {children}
    </Tag>
  );
}

/* ── Skeleton / loading ─────────────────────────────────────────────── */

export function Skeleton({ className }) {
  return <div className={cn("ui-skeleton", className)} />;
}

/** Drop-in skeleton matching the StatCard footprint. */
export function StatCardSkeleton() {
  return (
    <Card className="flex items-start justify-between">
      <div className="space-y-3 w-full">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-3 w-28" />
      </div>
      <Skeleton className="h-10 w-10 rounded-lg" />
    </Card>
  );
}

/* ── Empty state ────────────────────────────────────────────────────── */

export function EmptyState({ icon: Icon, title, description, action, className, tone = "neutral" }) {
  const iconTone = tone === "danger"
    ? "bg-rose-500/10 border-rose-500/20 text-rose-400"
    : "bg-zinc-800/50 border-zinc-700/50 text-zinc-500";
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-12 px-4", className)}>
      {Icon && (
        <div className={cn("w-11 h-11 rounded-xl border flex items-center justify-center mb-3", iconTone)}>
          <Icon size={20} />
        </div>
      )}
      <p className="text-sm font-medium text-zinc-300">{title}</p>
      {description && <p className="text-xs text-zinc-500 mt-1 max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Renders EmptyState in "couldn't load" framing with a Retry action, distinct
 * from a genuinely empty result set (e.g. "no data" vs "the request failed"). */
export function ErrorState({ title = "Couldn't load this", description, onRetry, className }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      tone="danger"
      title={title}
      description={description || "Check your connection and try again."}
      action={onRetry && (
        <Button size="sm" icon={RotateCw} onClick={onRetry}>Retry</Button>
      )}
      className={className}
    />
  );
}

/** 1-5 star rating for auditor transparency scoring. Read-only once `value`
 * is set (rating is a one-time judgment, not editable after submit). */
export function StarRating({ value, onRate, disabled, size = 16 }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onRate?.(n)}
          className={cn(
            "transition-colors",
            disabled ? "cursor-default" : "cursor-pointer hover:scale-110",
          )}
          title={`${n} star${n > 1 ? "s" : ""}`}
        >
          <Star
            size={size}
            className={value && n <= value ? "fill-amber-400 text-amber-400" : "text-zinc-700"}
          />
        </button>
      ))}
    </div>
  );
}

/* ── Form controls ──────────────────────────────────────────────────── */

const FIELD_BASE =
  "w-full bg-[#09090b] border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500/60 " +
  "text-zinc-200 rounded-lg text-sm focus:outline-none transition-colors placeholder-zinc-600 " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

export function Field({ label, hint, children, className }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-400">{label}</label>}
      {children}
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

export function Input({ className, ...rest }) {
  return <input className={cn(FIELD_BASE, "px-3 py-2", className)} {...rest} />;
}

export function Textarea({ className, ...rest }) {
  return <textarea className={cn(FIELD_BASE, "px-3 py-2", className)} {...rest} />;
}

export function Select({ className, children, ...rest }) {
  return (
    <select className={cn(FIELD_BASE, "px-3 py-2 cursor-pointer", className)} {...rest}>
      {children}
    </select>
  );
}

export function SearchInput({ className, ...rest }) {
  return (
    <div className={cn("relative", className)}>
      <SearchIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
      <input className={cn(FIELD_BASE, "pl-9 pr-3 py-2")} {...rest} />
    </div>
  );
}

/* ── Modal ──────────────────────────────────────────────────────────── */

export function Modal({ open, onClose, title, description, children, size = "sm" }) {
  if (!open) return null;
  const widths = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-2xl" };
  return (
    <div
      className="fixed inset-0 bg-[#09090b]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        className={cn(
          "ui-card ui-fade-in w-full p-6 shadow-2xl relative space-y-5",
          widths[size] || widths.sm
        )}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-zinc-500 hover:text-zinc-200 cursor-pointer transition-colors"
          aria-label="Close"
        >
          <X size={16} />
        </button>
        {(title || description) && (
          <div className="space-y-1 pr-6">
            {title && <h3 className="text-lg font-semibold text-zinc-100">{title}</h3>}
            {description && <p className="text-xs text-zinc-400 truncate">{description}</p>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/* ── Progress bar ───────────────────────────────────────────────────── */

export function ProgressBar({ value = 0, className, tone = "accent" }) {
  const fill = {
    accent: "bg-indigo-400",
    success: "bg-emerald-400",
    warning: "bg-amber-400",
    danger: "bg-rose-400",
    neutral: "bg-zinc-200",
  }[tone];
  return (
    <div className={cn("w-full h-1.5 rounded-full bg-zinc-800/80 overflow-hidden", className)}>
      <div
        className={cn("h-full rounded-full transition-all duration-700", fill)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

// ===== TOAST (sonner wrapper) =====

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        className: 'glass-card-static',
      }}
      theme="dark"
      richColors
      closeButton
    />
  );
}

export { toast };

// ===== ANIMATED COUNTER =====
export function AnimatedCounter({ value, prefix = '', suffix = '', className = '' }) {
  const [display, setDisplay] = React.useState(0);
  
  React.useEffect(() => {
    const target = typeof value === 'number' ? value : parseInt(value) || 0;
    if (target === 0) { setDisplay(0); return; }
    const duration = 800;
    const steps = 30;
    const increment = target / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= target) {
        setDisplay(target);
        clearInterval(timer);
      } else {
        setDisplay(Math.floor(current));
      }
    }, duration / steps);
    return () => clearInterval(timer);
  }, [value]);
  
  return <span className={`animate-count-up ${className}`}>{prefix}{display.toLocaleString()}{suffix}</span>;
}

// ===== GAUGE CHART =====
export function GaugeChart({ value = 0, max = 100, size = 120, strokeWidth = 10, label = '', color = '#6366f1' }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(value / max, 1);
  const offset = circumference * (1 - progress);
  const percentage = Math.round(progress * 100);
  
  // Color based on percentage
  const getColor = () => {
    if (percentage >= 80) return '#10b981';
    if (percentage >= 60) return '#f59e0b';
    if (percentage >= 40) return '#f97316';
    return '#ef4444';
  };
  
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="gauge-ring" width={size} height={size}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(63, 63, 70, 0.3)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color === 'auto' ? getColor() : color}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-zinc-100">{percentage}%</span>
        </div>
      </div>
      {label && <span className="text-xs text-zinc-400 font-medium">{label}</span>}
    </div>
  );
}

// ===== TOOLTIP =====
export function Tooltip({ children, content, position = 'top' }) {
  const [show, setShow] = React.useState(false);
  const positions = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };
  return (
    <div className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div className={`absolute ${positions[position]} z-50 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 whitespace-nowrap shadow-xl animate-scale-in`}>
          {content}
        </div>
      )}
    </div>
  );
}

// ===== PROGRESS RING =====
export function ProgressRing({ value = 0, size = 40, strokeWidth = 3, color = '#6366f1' }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(value / 100, 1));
  return (
    <svg width={size} height={size} className="gauge-ring">
      <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="rgba(63,63,70,0.3)" strokeWidth={strokeWidth} />
      <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />
    </svg>
  );
}
