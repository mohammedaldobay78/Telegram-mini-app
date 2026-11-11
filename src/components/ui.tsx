"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-button text-button-text active:scale-[0.98] disabled:opacity-40 shadow-sm shadow-black/20",
  secondary:
    "bg-surface text-text border border-white/10 active:scale-[0.98] disabled:opacity-40",
  ghost: "bg-transparent text-hint active:bg-white/5 disabled:opacity-40",
  danger: "bg-danger/15 text-danger border border-danger/30 active:scale-[0.98] disabled:opacity-40",
};

export function Button({
  variant = "primary",
  className = "",
  children,
  loading,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition ${VARIANTS[variant]} ${className}`}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl border border-white/10 bg-surface/70 p-4 backdrop-blur ${className}`}>
      {children}
    </div>
  );
}

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const tones = {
    neutral: "bg-white/10 text-text",
    good: "bg-emerald-400/15 text-emerald-300",
    warn: "bg-amber-400/15 text-amber-300",
    bad: "bg-rose-400/15 text-rose-300",
  };
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
}

export function ProgressBar({ value, max, className = "" }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={`h-2.5 w-full overflow-hidden rounded-full bg-black/30 ${className}`}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-hidden
    />
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-2 flex items-end justify-between px-1">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-hint">{children}</h2>
      {hint ? <span className="text-xs text-hint">{hint}</span> : null}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-3xl border border-dashed border-white/10 p-6 text-center text-sm text-hint">{children}</div>;
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose?: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-bg p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold">{title}</h3>
          {onClose ? (
            <button onClick={onClose} className="rounded-full px-2 py-1 text-hint" aria-label="Close">
              ✕
            </button>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl bg-black/20 p-3">
      <div className="text-[11px] uppercase tracking-wide text-hint">{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
      {hint ? <div className="text-[11px] text-hint">{hint}</div> : null}
    </div>
  );
}

export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200">
      <div className="flex items-center justify-between gap-3">
        <span>{children}</span>
        {onRetry ? (
          <button onClick={onRetry} className="shrink-0 text-xs font-semibold underline">
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}
