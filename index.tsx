// Wiederverwendbare UI-Bausteine des Designsystems.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { Link } from "react-router";

type Variant = "primary" | "dark" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-sun text-ink hover:bg-sun-deep",
  dark: "bg-ink text-white hover:bg-black",
  ghost: "bg-transparent text-ink hover:bg-ink/5 border border-line",
  danger: "bg-bad text-white hover:brightness-95",
};
const base =
  "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[15px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function ButtonLink({ to, variant = "primary", className = "", children }: { to: string; variant?: Variant; className?: string; children: ReactNode }) {
  return (
    <Link to={to} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <section className={`rounded-[var(--radius-card)] bg-paper p-5 sm:p-6 ${className}`}>{children}</section>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-soft">{hint}</span>}
    </label>
  );
}

const fieldClass =
  "w-full rounded-[var(--radius-field)] border border-line bg-paper px-3.5 py-2.5 text-[15px] placeholder:text-ink-soft/60 focus:border-ink focus:outline-none";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${fieldClass} ${props.className ?? ""}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={`${fieldClass} resize-y ${props.className ?? ""}`} />;
}

export function ProgressBar({ value, max, tone = "sun" }: { value: number; max: number; tone?: "sun" | "good" | "warn" | "bad" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color = { sun: "bg-sun", good: "bg-good", warn: "bg-warn", bad: "bg-bad" }[tone];
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-mist" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Alert({ tone = "bad", children }: { tone?: "bad" | "good" | "warn"; children: ReactNode }) {
  const styles = {
    bad: "bg-bad/10 text-bad",
    good: "bg-good/10 text-good",
    warn: "bg-warn/15 text-[#9a5200]",
  }[tone];
  return <p role="alert" className={`rounded-[var(--radius-field)] px-4 py-3 text-sm font-medium ${styles}`}>{children}</p>;
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display text-xl font-extrabold tracking-tight ${className}`}>
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
        <circle cx="13" cy="13" r="12" fill="var(--color-sun)" stroke="var(--color-ink)" strokeWidth="2" />
        <circle cx="13" cy="13" r="5" fill="var(--color-ink)" />
      </svg>
      MyLife
    </span>
  );
}
